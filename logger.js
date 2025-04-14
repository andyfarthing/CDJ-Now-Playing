import winston from "winston";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { format, transports } = winston;

// Define log levels and colors
const logLevels = {
	levels: {
		error: 0,
		warn: 1,
		info: 2,
		debug: 3,
	},
	colors: {
		error: "red",
		warn: "yellow",
		info: "green",
		debug: "blue",
	},
};

winston.addColors(logLevels.colors);

// Make sure the logs directory exists
try {
	if (!fs.existsSync(path.join(__dirname, "logs"))) {
		fs.mkdirSync(path.join(__dirname, "logs"));
	}
} catch (err) {
	console.error("Error creating logs directory:", err);
}

// Configure format for Console (with colors and timestamps)
const consoleFormat = format.combine(
	format.timestamp({ format: "DD/MM/YYYY HH:mm:ss" }),
	format.colorize({ all: false }),
	format.printf((info) => {
		const { timestamp, level, message, metadata, ...rest } = info;
		// Handle metadata whether passed directly or via the defaultMeta
		const meta = metadata || rest;
		const service = meta.service || "unknown";
		const metaObj = { ...meta };
		delete metaObj.service; // Remove service from meta object as we're displaying it separately
		const metaStr = Object.keys(metaObj).length
			? ` ${JSON.stringify(metaObj)}`
			: "";
		return `[${timestamp}] [${level}] [${service}]: ${message}${metaStr}`;
	})
);

// Configure format for File (with timestamps but no colors)
const fileFormat = format.combine(
	format.timestamp({ format: "DD/MM/YYYY HH:mm:ss" }),
	format.printf((info) => {
		const { timestamp, level, message, metadata, ...rest } = info;
		// Handle metadata whether passed directly or via the defaultMeta
		const meta = metadata || rest;
		const service = meta.service || "unknown";
		const metaObj = { ...meta };
		delete metaObj.service; // Remove service from meta object as we're displaying it separately
		const metaStr = Object.keys(metaObj).length
			? ` ${JSON.stringify(metaObj)}`
			: "";
		return `[${timestamp}] [${level}] [${service}]: ${message}${metaStr}`;
	})
);

// Configure transports
const logTransports = [
	new transports.Console({
		format: consoleFormat,
	}),
	new transports.File({
		filename: path.join(__dirname, "logs", "application.log"),
		maxsize: 1 * 1024 * 1024, // 1MB
		maxFiles: 3,
		tailable: true,
		format: fileFormat,
	}),
];

// Create the logger
const logger = winston.createLogger({
	levels: logLevels.levels,
	level: process.env.LOG_LEVEL || "info",
	transports: logTransports,
	defaultMeta: { service: "now-playing" },
});

// Export the logger directly
export default logger;
