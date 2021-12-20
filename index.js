import express from "express";
import startup from "./lib/startup";
import api from "./api/index";
import middleware from "./middleware/index";
import logger from "./lib/logger";
import https from "https";
import cors from "cors";
import fs from "fs";
import { WebSocketServer } from "ws";
import { parse } from "url";
import thisBooleanValue from "es-abstract/2015/thisBooleanValue";

startup()
  .then(() => {
    var privateKey = fs.readFileSync("../ssl/server.key");
    var certificate = fs.readFileSync("../ssl/server.pem");

    const app = express();

    middleware(app);
    api(app);

    app.get("/api/users", (req, res) => {
      const userList = [];
      userConnections.forEach((ws, key) => {
        userList.push({
          id: key,
        });
      });
      res.end(JSON.stringify(userList));
    });

    const server = https
      .createServer(
        {
          key: privateKey,
          cert: certificate,
        },
        app
      )
      .listen(9001);
    const wss = new WebSocketServer({
      noServer: true,
    });
    const userConnections = new Map();
    function broadcast(data, skipUserIds = []) {
      if (typeof data === "object") {
        data = JSON.stringify(data);
      }
      console.log("broadcast", data);
      userConnections.forEach((ws, key) => {
        if (skipUserIds.includes(key)) {
          return;
        }
        ws.send(data);
      });
    }

    function sendMessageToUser(toUserId, type, payload) {
      const toUserConn = userConnections.get(toUserId);
      toUserConn.send(
        JSON.stringify({
          type,
          payload,
        })
      );
    }

    wss.on("connection", function connection(ws) {
      ws.on("message", function (data, isBinary) {
        if (!isBinary) {
          const message = JSON.parse(data.toString());
          const { type, payload } = message;
          console.log(message);
          switch (type) {
            case "login":
              const userId = payload.userId;
              this.userId = userId;
              userConnections.set(userId, this);
              broadcast(
                {
                  type: "user_connected",
                  payload: {
                    userId,
                  },
                },
                [userId]
              );

              break;
            case "offer":
            case "candidate":
            case "answer":
              const { toUserId } = payload;
              sendMessageToUser(toUserId, type, {
                ...payload,
                fromUserId: this.userId,
              });
            default:
          }
        }
      });

      ws.on("close", function (code, reason) {
        console.log("close", this.userId);
        userConnections.delete(this.userId);
        broadcast({
          type: "user_disconnected",
          payload: {
            userId: this.userId,
          },
        });
      });
    });

    server.on("upgrade", function upgrade(request, socket, head) {
      const { pathname } = parse(request.url);

      if (pathname === "/websocket") {
        wss.handleUpgrade(request, socket, head, function done(ws) {
          wss.emit("connection", ws, request);
        });
      } else {
        socket.destroy();
      }
    });
    process.on("message", (message) => {
      console.log(message);
    });
  })
  .catch((error) => {
    logger.error(error);
  });
