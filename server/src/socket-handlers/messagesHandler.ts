import { Socket } from "socket.io";
import Message from "../models/message/messageModel";
import DriveService from "../services/driveService";
import Attachment from "../models/message/attachmentModel";
import { startSession } from "mongoose";

type Message = {
  id: string;
  textContent: any;
  sendAt: number;
  attachments: any;
  user: { _id: string; name: string };
};
class MessagesHandler {
  private driveService: DriveService;

  constructor() {
    this.driveService = new DriveService();
  }
  async sendMessage(
    socket: Socket,
    data: { channelId: string; message: Message; userId?: string },
    callback: Function
  ) {
    try {
      let attachments: any[] = [];
      if (data.message.attachments) {
        attachments = await this.uploadAttachments(data.message.attachments);
      }
      const message = await Message.create({
        _id: data.message.id,
        user: data.userId || socket.data.userId,
        textContent: data.message.textContent,
        channel: data.channelId,
        sendAt: data.message.sendAt,
        attachments: attachments?.map((attachment) => attachment._id) || [],
      });

      callback({ status: "success", message: "Message sent", attachments });
      if (!data.userId) {
        socket.broadcast.to(data.channelId).emit("receive-message", {
          message: {
            id: message.id,
            textContent: message.textContent,
            sendAt: message.sendAt,
            attachments: attachments,
            user: data.message.user,
          },
          channelId: data.channelId,
        });
      }
    } catch (error) {
      callback({ status: "error", message: "Error sending message" });
      console.error(error);
    }
  }

  async deleteMessage(
    socket: Socket,
    data: { messageId: string; channelId: string },
    callback: Function
  ) {
    const session = await startSession();
    session.startTransaction();

    try {
      const message = await Message.findById(data.messageId).session(session);
      if (!message) {
        throw new Error("Message not found");
      }

      if (message.user.id === socket.data.userId) {
        const attachmentIds = message.attachments.map((attachment) => attachment.toString());

        const attachments = await Attachment.find({ _id: { $in: attachmentIds } }).session(session);

        const existMessageWithAttachments = await Message.find({
          attachments: { $in: attachmentIds },
        }).session(session);

        const usedAttachmentIds = new Set();
        for (const message of existMessageWithAttachments) {
          for (const attachmentId of message.attachments) {
            if (attachmentIds.includes(attachmentId.toString())) {
              usedAttachmentIds.add(attachmentId.toString());
            }
          }
        }

        const unusedAttachments = attachments.filter(
          (attachment) => !usedAttachmentIds.has(attachment.id)
        );

        for (const attachment of unusedAttachments) {
          await this.driveService.deleteFile(attachment.url);
        }

        await Attachment.deleteMany({ _id: { $in: unusedAttachments.map((a) => a._id) } }).session(
          session
        );
      }

      await Message.deleteOne({ _id: data.messageId }).session(session);

      await session.commitTransaction();
      session.endSession();

      callback({ status: "success" });
      socket.broadcast.to(data.channelId).emit("on-deleted-message", data);
    } catch (error) {
      await session.abortTransaction();
      session.endSession();

      callback({ status: "error", message: "Error deleting message" });
      console.error(error);
    }
  }

  async editMessage(
    socket: Socket,
    data: { editedMessage: Message; channelId: string },
    callback: Function
  ) {
    try {
      await Message.updateOne(
        { _id: data.editedMessage.id },
        { $set: { textContent: data.editedMessage.textContent } }
      );

      callback({ status: "success" });
      socket.broadcast.to(data.channelId).emit("on-edited-message", data);
    } catch (error) {
      callback({ status: "error", message: "Error deleting message" });
      console.error(error);
    }
  }

  private async uploadAttachments(attachments: any[]) {
    try {
      const uploadAttachments = async (attachments: any[]) => {
        const fileDataArray = await Promise.all(
          attachments.map((attachment) => {
            if (attachment.path) {
              return this.driveService.uploadFile(attachment.path);
            } else if (attachment.url) {
              return { fileId: attachment.url };
            }
          })
        );
        return fileDataArray;
      };
      const fileDataArray = await uploadAttachments(
        attachments.map((attachment: { path: string; url: string }) => attachment)
      );
      const uploadedFiles = [];
      for (let i = 0; i < attachments.length; i++) {
        uploadedFiles.push({
          name: attachments[i].name,
          type: attachments[i].type,
          url: fileDataArray[i]?.fileId,
        });
      }

      const existingAttachments = await Attachment.find({
        url: { $in: uploadedFiles.map((file) => file.url) },
      });

      const existingUrls = new Set(existingAttachments.map((attachment) => attachment.url));

      const newAttachments = uploadedFiles.filter((file) => !existingUrls.has(file.url));

      const insertedAttachments = await Attachment.insertMany(newAttachments);

      return [...existingAttachments, ...insertedAttachments];
    } catch (error) {
      throw error;
    }
  }
}

export default new MessagesHandler();
