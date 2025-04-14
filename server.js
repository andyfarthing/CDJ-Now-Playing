import { parse } from "url";
import express from "express";
import next from "next";
import WebSocket from "ws";
import { WebSocketServer } from "ws";
import { startProlinkNetwork, setupProLinkWebsocket } from "./lib/prolink.js";
import log from "./logger.js";

const service = "server";
const app = express();
const server = app.listen(3000);
const wss = new WebSocketServer({ noServer: true });
const nextApp = next({ dev: process.env.NODE_ENV !== "production" });

startProlinkNetwork();

nextApp.prepare().then(() => {
	app.use((req, res, next) => {
		nextApp.getRequestHandler()(req, res, parse(req.url, true));
	});

	wss.on("connection", (ws) => {
		setupProLinkWebsocket(ws);
		ws.on("message", (message, isBinary) => {
			if (
				ws.readyState === WebSocket.OPEN &&
				message.toString() !== `{"event":"ping"}`
			) {
				log.debug("WebSocket message received", { service, message });
				ws.send(message, { binary: isBinary });
			}
		});
	});

	server.on("upgrade", (req, socket, head) => {
		const { pathname } = parse(req.url || "/", true);

		// Make sure we all for hot module reloading
		if (pathname === "/_next/webpack-hmr") {
			nextApp.getUpgradeHandler()(req, socket, head);
		}

		// Set the path we want to upgrade to WebSockets
		if (pathname === "/api/ws") {
			wss.handleUpgrade(req, socket, head, (ws) => {
				wss.emit("connection", ws, req);
			});
		}
	});
});
