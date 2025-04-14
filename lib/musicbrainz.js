import { MusicBrainzApi, CoverArtArchiveApi } from "musicbrainz-api";
import log from "../logger.js";

const service = "musicbrainz";

const mbApi = new MusicBrainzApi({
	appName: "now-playing",
	appVersion: "0.1.0",
	appContactInfo: "now-playing@now-playing.com",
});

const coverArtArchiveApiClient = new CoverArtArchiveApi();

export const getMusicBrainzArtwork = async (track) => {
	const releaseMbid = await findMusicbrainzRelease(track);
	if (releaseMbid) {
		const base64Image = await findMusicBrainzArtwork(track, releaseMbid);
		return base64Image;
	}
	return null;
};

const findMusicbrainzRelease = async (track) => {
	const artist = track.artist.name;
	const title = track.title;
	try {
		log.info("Looking for MusicBrainz recording", {
			service,
			track: `${artist} - ${title}`,
		});
		const result = await mbApi.search("recording", {
			query: { artist, recording: title, primarytype: "Single" },
		});
		if (result.recordings.length) {
			log.info("Found recording. Getting best guess release...", {
				service,
				track: `${artist} - ${title}`,
			});
			const releaseMbid = result.recordings[0].releases[0].id;
			log.info(`Using release ${releaseMbid}`, {
				service,
				track: `${artist} - ${title}`,
			});
			return releaseMbid;
		}
	} catch (error) {
		log.error(`Error getting MusicBrainz info: ${error}`, {
			service,
			track: `${artist} - ${title}`,
		});
	}
	log.info("No MusicBrainz entry found", { service });
	return null;
};

const findMusicBrainzArtwork = async (track, releaseMbid) => {
	const artist = track.artist.name;
	const title = track.title;
	try {
		log.info(`Searching artwork for MusicBrainz release ${releaseMbid}...`, {
			service,
			track: `${artist} - ${title}`,
		});
		const covers = await coverArtArchiveApiClient.getReleaseCovers(releaseMbid);
		if (covers.images.length) {
			log.info("Artwork found", { service, track: `${artist} - ${title}` });
			const image = covers.images[0].image;
			const base64Image = await downloadAndEncodeImage(image);
			return base64Image;
		}
	} catch (error) {
		log.info(`No artwork found for MusicBrainz release ${releaseMbid}`, {
			service,
			track: `${artist} - ${title}`,
		});
	}
	return null;
};

const downloadAndEncodeImage = async (url) => {
	try {
		const response = await fetch(url);
		if (!response.ok) throw new Error("Failed to fetch the image");

		const arrayBuffer = await response.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);
		const base64Image = `data:image/jpeg;base64,${buffer.toString("base64")}`;
		return base64Image;
	} catch (error) {
		log.error("Error:", { message: error.message }, { service });
	}
	return null;
};
