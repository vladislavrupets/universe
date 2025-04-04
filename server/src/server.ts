import http from "http";
import { Server, Socket } from "socket.io";
import app from "./app";
import { api, db, client } from "./config/config";
import verifySocketJwt from "./middleware/verifySocketJwt";
import mongoose from "mongoose";
import connectionHandler from "./socket-handlers/connectionHandler";
import channelsHandler from "./socket-handlers/channelsHandler";
import messagesHandler from "./socket-handlers/messagesHandler";

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: client.url,
    methods: ["POST", "PUT", "GET", "OPTIONS", "HEAD"],
    credentials: true,
  },
});

io.use(verifySocketJwt).on("connection", (socket: Socket) => {
  console.info("User connected");

  connectionHandler.joinAndSendChannels(socket);

  socket.on("get-channel-messages", (data) => {
    channelsHandler.getMessages(socket, data);
  });
  socket.on("send-message", (data, callback) => {
    messagesHandler.sendMessage(socket, data, callback);
  });

  socket.on("add-user-to-channel", (data, callback) => {
    channelsHandler.addUserToChannel(io, socket, data, callback);
  });
  socket.on("create-channel", (data, callback) => {
    channelsHandler.createChannel(socket, data, callback);
  });
  socket.on("create-dm-channel", (data, callback) => {
    channelsHandler.createDMChannel(socket, data, callback);
  });
  socket.on("delete-channel", (data, callback) => {
    channelsHandler.deleteChannel(data, callback, io, socket);
  });
  socket.on("rename-channel", (data, callback) => {
    channelsHandler.renameChannel(socket, data, callback);
  });
  socket.on("leave-channel", (data, callback) => {
    channelsHandler.leaveChannel(socket, data, callback);
  });
  socket.on("update-channel-groups-order", (data, callback) => {
    channelsHandler.updateChannelGroupsOrder(socket, data, callback);
  });
  socket.on("delete-message", (data, callback) => {
    messagesHandler.deleteMessage(socket, data, callback);
  });
  socket.on("edit-message", (data, callback) => {
    messagesHandler.editMessage(socket, data, callback);
  });

  socket.on("disconnect", () => {
    console.info("User disconnected");
  });
});

(async () => {
  try {
    server.listen(api.port, () => {
      console.info(`Server started on ${api.port}`);
    });

    if (!db.mongoUri) {
      throw new Error("Mongo URI is not provided");
    }
    await mongoose.connect(db.mongoUri);
    console.info("MongoDB connected");
  } catch (error) {
    console.error(error);
  }
})();
