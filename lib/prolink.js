import {
	bringOnline,
	MixstatusProcessor,
	MixstatusMode,
} from "@andyfarthing/prolink-connect";
import { getMusicBrainzArtwork } from "./musicbrainz.js";
import log from "../logger.js";

const service = "prolink";

export const startProlinkNetwork = async () => {
	const proLinkNetwork = await connectToProlinkNetwork();
	startListener(proLinkNetwork);
	// Listen for SIGINT signal (CTRL + C)
	process.on("SIGINT", async () => handleSignal("SIGINT", proLinkNetwork));
	// Listen for SIGTERM signal (sent by `kill` command)
	process.on("SIGTERM", async () => handleSignal("SIGTERM", proLinkNetwork));
	// Listen for SIGHUP signal (sent when terminal is closed)
	process.on("SIGHUP", async () => handleSignal("SIGHUP", proLinkNetwork));
};

let websocket = undefined;

export const setupProLinkWebsocket = (ws) => {
	websocket = ws;
};

const disconnectFromProlinkNetwork = async (proLinkNetwork) => {
	if (!proLinkNetwork?.isConnected()) return;
	try {
		// Wrap cleanup logic in a Promise to manage timeout
		await Promise.race([
			(async () => {
				log.info("Disconnecting from ProLink network...", {
					service,
				});
				await proLinkNetwork.disconnect();
				log.info("Disconnected from ProLink network", { service });
			})(),
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("Cleanup timed out")), 5000)
			),
		]);
	} catch (error) {
		log.error("Cleanup failed:", { error });
	}
};

const handleSignal = async (signal, proLinkNetwork) => {
	log.info(`Received ${signal} signal, cleaning up...`, { service });
	await disconnectFromProlinkNetwork(proLinkNetwork);
	log.info("Cleanup successful", { service });
	process.exit();
};

const connectToProlinkNetwork = async () => {
	log.info("Bringing the ProLink network online...", { service });
	const proLinkNetwork = await bringOnline();

	log.info("Automatically configuring the ProLink network...", {
		service,
	});
	await proLinkNetwork.autoconfigFromPeers();

	log.info("Connecting to the ProLink network...", { service });
	proLinkNetwork.connect();

	if (!proLinkNetwork.isConnected()) {
		log.error("Failed to connect to the ProLink network");
		return;
	} else {
		log.info("Successfully connected to the ProLink network", {
			service,
		});
	}

	// Listen for other devices appearing on the network
	const connectedDevices = {};
	proLinkNetwork.deviceManager.on("connected", (device) => {
		if (!(device.id in connectedDevices)) {
			const { id, name } = device;
			log.info("New device found on ProLink network", {
				service,
				id,
				name,
			});
			connectedDevices[device.id] = device;
		}
	});

	return proLinkNetwork;
};

const deviceStates = {
	1: { state: undefined, artwork: undefined },
	2: { state: undefined, artwork: undefined },
	3: { state: undefined, artwork: undefined },
	4: { state: undefined, artwork: undefined },
};

const startListener = (proLinkNetwork) => {
	const mixProcessor = new MixstatusProcessor({
		mode: MixstatusMode.FollowsMaster,
	});

	proLinkNetwork.statusEmitter.on("status", async (state) => {
		const { deviceId, trackId } = state;
		if (
			deviceStates[deviceId].state === undefined ||
			deviceStates[deviceId].state.trackId !== trackId
		) {
			deviceStates[deviceId].state = state;
			if (trackId !== 0) {
				log.info("New track loaded", { trackId, service });
				const track = await getTrack(proLinkNetwork, state);
				const artwork = await getArtwork(proLinkNetwork, state, track);
				deviceStates[deviceId].artwork = artwork;
			}
		}
		mixProcessor.handleState(state);
	});
	// Listen for "now playing" changes and send track data to the UI
	mixProcessor.on("nowPlaying", async (state) => {
		// If we already have the track and artwork from previous loading, use it
		if (
			deviceStates[state.deviceId].state &&
			deviceStates[state.deviceId].artwork
		) {
			const track = await getTrack(proLinkNetwork, state);
			sendMetadataToUi(track, deviceStates[state.deviceId].artwork);
		} else {
			// Fallback to fetching everything if not available
			const track = await getTrack(proLinkNetwork, state);
			const artwork = await getArtwork(proLinkNetwork, state, track);
			deviceStates[state.deviceId].artwork = artwork;
			sendMetadataToUi(track, artwork);
		}
	});
	log.info("Now listening to the ProLink network", { service });
};

const getTrack = async (proLinkNetwork, state) => {
	const { trackDeviceId, trackSlot, trackType, trackId } = state;
	const track = await proLinkNetwork.db.getMetadata({
		deviceId: trackDeviceId,
		trackId,
		trackType,
		trackSlot,
	});
	if (track.label?.name) {
		track.label.name = track.label.name.replace(/\[no label\]/g, "no label");
	} else {
		track.label = { name: "unknown label" };
	}
	log.info("New track metadata received", {
		service,
		track: `${track.artist.name} - ${track.title}`,
		label: track.label.name,
		deviceId: state.deviceId,
		trackId,
	});
	return track;
};

const getArtwork = async (proLinkNetwork, state, track) => {
	const [proLinkArtwork, musicBrainzArtwork] = await Promise.all([
		getProLinkArtwork(proLinkNetwork, state, track),
		getMusicBrainzArtwork(track),
	]);
	if (musicBrainzArtwork) {
		log.info("Using MusicBrainz artwork", { service });
		return musicBrainzArtwork;
	} else {
		log.info("Using local artwork", { service });
		return proLinkArtwork;
	}
};

const getProLinkArtwork = async (proLinkNetwork, state, track) => {
	const { trackDeviceId, trackSlot, trackType } = state;
	// Append "_m" to filename to get higher resolution artwork
	// https://deep-symmetry.zulipchat.com/#narrow/stream/275855-dysentery-.26-crate-digger/topic/High.20res.20album.20art/near/289004764
	track.artwork.path = track.artwork.path.replace(".jpg", "_m.jpg");
	// Get artwork from the databse. This is returned as a Buffer object
	const buffer = await proLinkNetwork.db.getArtwork({
		deviceId: trackDeviceId,
		trackType,
		trackSlot,
		track,
	});
	if (buffer) {
		// Convert Buffer to a base64 string for use in an <img> element in the UI
		const base64Image = `data:image/jpeg;base64,${buffer.toString("base64")}`;
		return base64Image;
	}
	return null;
};

const sendMetadataToUi = (track, artwork) => {
	const metadata = { track, artwork };
	if (websocket?.readyState === WebSocket.OPEN) {
		websocket.send(JSON.stringify(metadata));
	}
};
