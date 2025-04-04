import io, { Socket } from 'socket.io-client';
import { create } from 'zustand';
import { api } from '../config/config';
import { Descendant } from 'slate';
import lodash from 'lodash';
import { Axios } from 'axios';
import FileSaver from 'file-saver';

export interface ChannelGroup {
  id: string;
  name: string;
  items: Array<Omit<Channel, 'messages'>>;
}
export interface DmWithUser {
  channel: string;
  user: { _id: string; name: string; pfp_url: string };
}

export interface ChannelMessages extends Channel {
  id: string;
  messages: UserMessage[];
  page: number;
  users: any;
  readonly: boolean;
  hasMoreMessages: boolean;
}

export interface Channel {
  id: string;
  name: string;
  user?: { _id?: string };
  ownerId?: string;
}

export type UserMessage = Message & MessageInfo;

export interface MessageInfo {
  id: string;
  user: { _id: string; name: string };
  sendAt: number;
}

export interface Message {
  textContent: MessageTextContent[];
  status: MessageStatus;
  attachments: any[];
}

export enum MessageStatus {
  SENDING,
  FAILED,
  SUCCESS,
}

export type MessageTextContent = Descendant & {
  children: any[];
  type: string;
};

interface MessageResponse {
  status: string;
  message: string;
  attachments: any[];
}

interface MessengerState {
  socket: Socket | null;
  channelGroups: ChannelGroup[];
  dmsWithUsers: DmWithUser[];
  notesChannel: Channel;
  channels: ChannelMessages[];
  lastSentMessage: {
    message: UserMessage | null;
    channelId: string;
  };
  lastDeletedMessage: {
    messageId: string;
    channelId: string;
  };
  lastEditedMessage: {
    message: UserMessage | null;
    channelId: string;
  };
  editingMessage: UserMessage | null;
  currentChannel: Omit<Channel, 'messages'> | null;
  error: Error | null;
  connectSocket: () => void;
  setCurrentChannel: (id: string, name: string, userId?: string) => void;
  setEditingMessage: (message: UserMessage | null) => void;
  getChannelGroups: () => void;
  loadChannelMessages: () => void;
  proccessUploadingAttachments: (
    axios: Axios,
    attachments: File[]
  ) => Promise<string | null>;
  processDownloadingAttachment: (
    axios: Axios,
    fileId: string,
    fileName: string
  ) => Promise<void>;
  sendMessage: (fileId: string | null, message: any) => void;
  recieveMessage: () => void;
  sendMessageToNotes: (message: UserMessage, userId: string) => void;
  onRecieveChannelMessages: (data: {
    messages: UserMessage[];
    users: any;
    hasMoreMessages: boolean;
  }) => void;
  updateChannelGroupsOrder: (newChannelGroups: ChannelGroup[]) => void;
  addUserToChannel: (id: string[], channelId?: string) => void;
  onUserJoinedChannel: (currentUserId: string) => void;
  createChannel: (data: {
    name: string;
    private: boolean;
    readonly: boolean;
  }) => void;
  deleteChannel: (id: string) => void;
  renameChannel: (id: string, name: string) => void;
  onChannelRenamed: () => void;
  leaveChannel: (id: string) => void;
  onUserLeftChannel: () => void;
  onDeletedChannel: () => void;
  deleteMessage: (messageId: string, channelId: string) => void;
  createDM: (data: any) => void;
  onDeletedMessage: () => void;
  editMessage: (editedMessage: any, channelId: string) => void;
  onEditedMessage: () => void;
}

const useMessengerStore = create<MessengerState>((set, get) => ({
  socket: null,
  channelGroups: [],
  dmsWithUsers: [],
  notesChannel: { id: '', name: 'Notes' },
  channels: [],
  currentChannel: null,
  error: null,
  lastSentMessage: {
    message: null,
    channelId: '',
  },
  lastDeletedMessage: {
    messageId: '',
    channelId: '',
  },
  lastEditedMessage: {
    message: null,
    channelId: '',
  },
  editingMessage: null,

  connectSocket: () => {
    try {
      const socket = io(api.url, {
        withCredentials: true,
      });
      set({ socket, error: null });
    } catch (error: any) {
      set({ error });
    }
  },

  setCurrentChannel: (id: string, name: string, userId?: string) => {
    set({
      currentChannel: {
        id,
        name,
        user: { _id: userId },
      },
    });
  },

  setEditingMessage: (message: UserMessage | null) => {
    set({ editingMessage: message });
  },

  getChannelGroups: () => {
    try {
      const { socket } = get();

      if (!socket) return;

      socket.once('send-channels', data => {
        const channels = data.channelGroups.flatMap(
          (channelGroup: ChannelGroup) => {
            return channelGroup.items;
          }
        );
        channels.push(
          ...data.dmsWithUsers.map((dm: DmWithUser) => {
            return { id: dm.channel };
          })
        );
        channels.push(data.notesChannel);

        channels.forEach((channel: ChannelMessages) => {
          channel.hasMoreMessages = true;
        });

        set({
          channelGroups: data.channelGroups,
          dmsWithUsers: data.dmsWithUsers,
          notesChannel: data.notesChannel,
          currentChannel: {
            ...data.notesChannel,
          },
          channels,
          error: null,
        });
      });
    } catch (error: any) {
      set({ error });
    }
  },

  proccessUploadingAttachments: async (axios: Axios, attachments: File[]) => {
    try {
      if (!attachments || attachments.length === 0) {
        return null;
      }
      const formData = new FormData();
      attachments.forEach(file => {
        formData.append('files', file);
      });

      const response = await axios.post('/file/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      return response.data.filesData;
    } catch (error) {
      return error;
    }
  },

  processDownloadingAttachment: async (
    axios: Axios,
    fileId: string,
    fileName: string
  ): Promise<void> => {
    try {
      if (!fileId) return;
      const response = await axios.get(`/file/download/${fileId}`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: response.headers['content-type'],
      });

      const contentDisposition = response.headers['content-disposition'];
      let filename = fileName;
      if (
        contentDisposition &&
        contentDisposition.indexOf('attachment') !== -1
      ) {
        const match = contentDisposition.match(/filename="?(.+)"?/);
        if (match?.[1]) {
          filename = match[1];
        }
      }

      FileSaver.saveAs(blob, filename);
    } catch (error) {}
  },

  sendMessage: (filesData: any, message: UserMessage) => {
    const { socket, currentChannel, channels, dmsWithUsers } = get();

    if (!socket || !currentChannel) return;

    if (filesData instanceof Error) {
      const errorMessage = {
        ...message,
        id: generateObjectId(),
        status: MessageStatus.FAILED,
        sendAt: Date.now(),
        attachments: [],
      };
      for (const channel of channels) {
        if (channel.id === currentChannel.id) {
          if (!channel.messages) {
            channel.messages = [];
          }
          channel.messages.unshift(errorMessage);
        }
      }
      set({
        channels: [...channels],
      });
      return;
    }

    const newMessage = {
      ...message,
      id: generateObjectId(),
      status: MessageStatus.SENDING,
      sendAt: Date.now(),
      attachments: filesData,
    };

    let messageCopy: UserMessage | undefined;
    for (const channel of channels) {
      if (channel.id === currentChannel.id) {
        if (!channel.messages) {
          channel.messages = [];
        }
        channel.messages.unshift(newMessage);
        messageCopy = channel.messages[0];
      }
    }

    if (!messageCopy) {
      return;
    }

    set({
      channels: [...channels],
      lastSentMessage: {
        message: messageCopy,
        channelId: currentChannel.id,
      },
    });

    const timeout = setTimeout(() => {
      messageCopy.status = MessageStatus.FAILED;
      set({ channels: [...channels] });
    }, 10000);

    socket.emit(
      'send-message',
      {
        message: newMessage,
        channelId: currentChannel.id,
      },
      (response: MessageResponse) => {
        clearTimeout(timeout);
        const updatedDm = dmsWithUsers.find(
          dm => dm.channel === currentChannel.id
        );
        const updatedDmIndex = dmsWithUsers.findIndex(
          dm => dm.channel === currentChannel.id
        );
        if (updatedDm) {
          dmsWithUsers.splice(updatedDmIndex, 1);
          set({ dmsWithUsers: [updatedDm, ...dmsWithUsers] });
        }
        if (response.status === 'error') {
          messageCopy.status = MessageStatus.FAILED;
          set({
            channels: [...channels],
          });
        }
        if (response.status === 'success') {
          messageCopy.status = MessageStatus.SUCCESS;
          messageCopy.attachments = response.attachments;
          set({ channels: [...channels] });
        }
      }
    );
  },

  recieveMessage: () => {
    try {
      const { socket } = get();

      if (!socket) return;

      socket.on(
        'receive-message',
        (data: { channelId: string; message: UserMessage }): void => {
          const { channels, dmsWithUsers } = get();

          const updatedChannels = channels.map(channel => {
            if (channel.id === data.channelId) {
              if (!channel.messages) {
                channel.messages = [];
              }
              return {
                ...channel,
                messages: [data.message, ...channel.messages],
              };
            }
            return channel;
          });
          const updatedDm = dmsWithUsers.find(
            dm => dm.channel === data.channelId
          );
          const updatedDmIndex = dmsWithUsers.findIndex(
            dm => dm.channel === data.channelId
          );
          if (updatedDm) {
            dmsWithUsers.splice(updatedDmIndex, 1);
            set({ dmsWithUsers: [updatedDm, ...dmsWithUsers] });
          }

          set({
            channels: updatedChannels,
            lastSentMessage: {
              ...data,
            },
            error: null,
          });
        }
      );
    } catch (error: any) {
      set({ error });
    }
  },

  sendMessageToNotes: (message: UserMessage, userId: string) => {
    const { socket, notesChannel, channels } = get();

    if (!socket) return;

    const newMessage = {
      ...message,
      sendAt: Date.now(),
      id: generateObjectId(),
      status: MessageStatus.SENDING,
    };
    let messageCopy: UserMessage | undefined;
    for (const channel of channels) {
      if (channel.id === notesChannel.id) {
        if (!channel.messages) {
          channel.messages = [];
        }
        channel.messages.unshift(newMessage);
        messageCopy = channel.messages[0];
      }
    }

    if (!messageCopy) {
      return;
    }

    set({
      channels: [...channels],
      lastSentMessage: {
        message: messageCopy,
        channelId: notesChannel.id,
      },
    });

    const timeout = setTimeout(() => {
      messageCopy.status = MessageStatus.FAILED;
      set({ channels: [...channels] });
    }, 10000);

    socket.emit(
      'send-message',
      {
        message: newMessage,
        channelId: notesChannel.id,
        userId,
      },
      (response: MessageResponse) => {
        clearTimeout(timeout);
        if (response.status === 'error') {
          messageCopy.status = MessageStatus.FAILED;
          set({
            channels: [...channels],
          });
        }
        if (response.status === 'success') {
          messageCopy.status = MessageStatus.SUCCESS;
          set({ channels: [...channels] });
        }
      }
    );
  },

  updateChannelGroupsOrder: (updChannelGroups: ChannelGroup[]) => {
    const { socket, channelGroups } = get();

    if (!socket) {
      return;
    }

    const hasGroupsChanged = !lodash.isEqual(
      channelGroups.map(group => ({
        id: group.id,
        name: group.name,
        items: group.items.map(item => item.id),
      })),
      updChannelGroups.map(group => ({
        id: group.id,
        name: group.name,
        items: group.items.map(item => item.id),
      }))
    );

    if (!hasGroupsChanged) {
      return;
    }

    socket.emit(
      'update-channel-groups-order',
      {
        channelGroups,
        updChannelGroups,
      },
      (response: MessageResponse) => {
        if (response.status === 'success') {
          set({ channelGroups: [...updChannelGroups] });
        }
      }
    );
  },

  loadChannelMessages: (): void => {
    try {
      const { socket, channels, currentChannel } = get();
      if (!socket || !currentChannel) return;

      const currentPage =
        channels.find(channel => channel.id === currentChannel.id)?.page ?? 0;

      socket.emit('get-channel-messages', {
        channelId: currentChannel.id,
        limit: 20,
        page: currentPage,
      });
    } catch (error: any) {
      set({ error });
    }
  },

  onRecieveChannelMessages: (data: {
    messages: UserMessage[];
    users: any;
    hasMoreMessages: boolean;
  }): void => {
    const { channels, currentChannel } = get();
    if (!currentChannel) return;

    const updatedChannels = channels.map(channel => {
      if (channel.id === currentChannel.id) {
        const existingMessages = channel.messages || [];
        const existingMessageIds = new Set(existingMessages.map(msg => msg.id));

        const newMessages = data.messages.filter(
          msg => !existingMessageIds.has(msg.id)
        );

        return {
          ...channel,
          messages: [...existingMessages, ...newMessages],
          page: channel.page ? channel.page + 1 : 1,
          users: data.users,
          hasMoreMessages: data.hasMoreMessages,
        };
      }
      return channel;
    });

    set({ channels: updatedChannels });
  },

  deleteMessage: (messageId: string, channelId: string) => {
    const { socket } = get();

    if (!socket) return;

    socket.emit(
      'delete-message',
      {
        messageId,
        channelId,
      },
      (response: MessageResponse) => {
        if (response.status === 'success') {
          const { channels } = get();

          const updatedChannels = channels.map(channel => {
            if (channel.id === channelId) {
              return {
                ...channel,
                messages: channel.messages.filter(
                  message => message.id !== messageId
                ),
              };
            }
            return channel;
          });
          set({ channels: [...updatedChannels] });
        } else {
          throw new Error('Error deleting message');
        }
      }
    );
  },

  onDeletedMessage: () => {
    try {
      const { socket } = get();

      if (!socket) return;

      socket.on(
        'on-deleted-message',
        (data: { messageId: string; channelId: string }): void => {
          const { channels } = get();

          const updatedChannels = channels.map(channel => {
            if (channel.id === data.channelId) {
              return {
                ...channel,
                messages: channel.messages.filter(
                  message => message.id !== data.messageId
                ),
              };
            }
            return channel;
          });

          set({ channels: [...updatedChannels], lastDeletedMessage: data });
        }
      );
    } catch (error: any) {
      set({ error });
    }
  },

  editMessage: (editedMessage: UserMessage, channelId: string) => {
    const { socket } = get();

    if (!socket) return;

    socket.emit(
      'edit-message',
      {
        editedMessage,
        channelId,
      },
      (response: MessageResponse) => {
        if (response.status === 'success') {
          const { channels } = get();

          const updatedChannels = channels.map(channel => {
            if (channel.id === channelId) {
              return {
                ...channel,
                messages: channel.messages.map(message => {
                  if (message.id === editedMessage.id) {
                    return editedMessage;
                  }
                  return message;
                }),
              };
            }
            return channel;
          });
          set({
            channels: [...updatedChannels],
            editingMessage: null,
            lastEditedMessage: { message: editedMessage, channelId },
          });
        } else {
          throw new Error('Error editing message');
        }
      }
    );
  },

  onEditedMessage: () => {
    try {
      const { socket } = get();

      if (!socket) return;

      socket.on(
        'on-edited-message',
        (data: { editedMessage: UserMessage; channelId: string }): void => {
          const { channels } = get();

          const updatedChannels = channels.map(channel => {
            if (channel.id === data.channelId) {
              return {
                ...channel,
                messages: channel.messages.map(message => {
                  if (message.id === data.editedMessage.id) {
                    return data.editedMessage;
                  }
                  return message;
                }),
              };
            }
            return channel;
          });

          set({
            channels: [...updatedChannels],
            lastEditedMessage: {
              message: data.editedMessage,
              channelId: data.channelId,
            },
          });
        }
      );
    } catch (error: any) {
      set({ error });
    }
  },

  addUserToChannel: (ids: string[], channel?: any) => {
    const { socket, channels, currentChannel, channelGroups } = get();

    if (!socket) return;

    let itsMe = false;
    let chlId = currentChannel?.id;

    if (channel) {
      itsMe = true;
      chlId = channel.id;
    }

    socket.emit(
      'add-user-to-channel',
      {
        channelId: chlId,
        ids,
      },
      (response: any) => {
        if (response.status === 'success') {
          const updatedChannels = channels.map(channel => {
            if (channel.id === chlId) {
              return {
                ...channel,
                users: [...channel.users, ...ids.map(id => ({ _id: id }))],
              };
            }
            return channel;
          });
          set({ channels: updatedChannels });
          if (itsMe) {
            const newChannel = {
              ...channel,
              messages: [],
              page: 0,
              users: [...channel.users, ...ids.map(id => ({ _id: id }))],
            };
            const updatedChannelGroups = channelGroups.map(channelGroup => {
              if (channelGroup.name === 'General') {
                channelGroup.items.push(channel);
              }
              return channelGroup;
            });
            set({
              channels: [newChannel, ...channels],
              channelGroups: updatedChannelGroups,
            });
          }
        }
      }
    );
  },

  onUserJoinedChannel: (currentUserId: string) => {
    const { socket } = get();
    if (!socket) return;

    socket.on(
      'user-joined-channel',
      (data: {
        channel: {
          id: string;
          name: string;
          users: { _id: string; name: string };
          owner: string;
          readonly: boolean;
        };
        userIds: string[];
      }) => {
        const { channels, channelGroups } = get();

        for (const userId of data.userIds) {
          if (currentUserId !== userId) {
            const updatedChannels = channels.map(channel => {
              if (channel.id === data.channel.id) {
                return {
                  ...channel,
                  users: data.channel.users,
                };
              }
              return channel;
            });

            set({ channels: [...updatedChannels] });
          } else {
            const newChannel = {
              ...data.channel,
              messages: [],
              page: 0,
              hasMoreMessages: true,
            };
            const updatedChannelGroups = channelGroups.map(channelGroup => {
              if (channelGroup.name === 'General') {
                channelGroup.items.push(data.channel);
              }
              return channelGroup;
            });

            set({
              channels: [newChannel, ...channels],
              channelGroups: updatedChannelGroups,
            });
          }
        }
      }
    );
  },
  onUserLeftChannel: () => {
    const { socket } = get();
    if (!socket) return;
    socket.on(
      'user-left-channel',
      (data: { channel: string; userId: string }) => {
        const { channels } = get();
        const updatedChannels = channels.map(channel => {
          if (channel.id === data.channel) {
            return {
              ...channel,
              users: channel.users.filter(
                (user: { _id: string }) => user._id !== data.userId
              ),
            };
          }
          return channel;
        });
        set({ channels: [...updatedChannels] });
      }
    );
  },

  createChannel: (data: {
    name: string;
    private: boolean;
    readonly: boolean;
  }): void => {
    const { socket, channelGroups, channels } = get();

    if (!socket) return;
    socket.emit('create-channel', data, (response: any) => {
      if (response.status === 'success') {
        const updatedChannel = {
          ...response.data,
          id: response.data._id,
          messages: [],
          page: 0,
          users: [{ _id: response.data.owner, name: response.data.name }],
          hasMoreMessages: false,
        };

        const updatedChannelGroups = channelGroups.map(channelGroup => {
          if (channelGroup.name === 'General') {
            channelGroup.items.push({
              id: response.data._id,
              name: response.data.name,
            });
          }
          return channelGroup;
        });
        set({
          channels: [updatedChannel, ...channels],
          channelGroups: updatedChannelGroups,
          currentChannel: {
            id: response.data._id,
            name: response.data.name,
          },
        });
      }
    });
  },
  createDM: (data: {
    user1Id: string;
    user2Id: string;
    userName: string;
    pfp_url: string;
  }): void => {
    const { socket, setCurrentChannel, dmsWithUsers, channels } = get();

    if (!socket) return;
    socket.emit(
      'create-dm-channel',
      { user1Id: data.user1Id, user2Id: data.user2Id },
      (response: any) => {
        if (response.status === 'success') {
          setCurrentChannel(response.data._id, data.userName, data.user2Id);
          set({
            dmsWithUsers: [
              {
                channel: response.data._id,
                user: {
                  _id: data.user2Id,
                  name: data.userName,
                  pfp_url: data.pfp_url,
                },
              },
              ...dmsWithUsers,
            ],
            channels: [
              {
                id: response.data._id,
                messages: [],
                page: 0,
                users: [],
                name: data.userName,
                readonly: false,
                hasMoreMessages: false,
              },
              ...channels,
            ],
          });
        }
      }
    );
  },
  onDeletedChannel: (): void => {
    const { socket } = get();

    if (!socket) return;
    socket.on('channel-deleted', (data: { channel: string }) => {
      const { channels, channelGroups, notesChannel, currentChannel } = get();
      const updatedChannels = channels.filter(
        channel => channel.id === data.channel
      );

      const updatedChannelGroups = channelGroups.map(channelGroup => ({
        ...channelGroup,
        items: channelGroup.items.filter(item => item.id !== data.channel),
      }));
      if (currentChannel?.id === data.channel) {
        set({
          currentChannel: {
            id: notesChannel.id,
            name: notesChannel.name,
          },
        });
      }
      set({
        channels: [...updatedChannels],
        channelGroups: updatedChannelGroups,
      });
    });
  },

  deleteChannel: (id: string): void => {
    const { socket, channelGroups, channels, notesChannel } = get();

    if (!socket) return;
    socket.emit('delete-channel', id, (response: any) => {
      if (response.status === 'success') {
        const updatedChannels = channels.filter(channel => channel.id !== id);

        const updatedChannelGroups = channelGroups.map(channelGroup => ({
          ...channelGroup,
          items: channelGroup.items.filter(item => item.id !== id),
        }));

        set({
          channels: updatedChannels,
          channelGroups: updatedChannelGroups,
          currentChannel: {
            id: notesChannel.id,
            name: notesChannel.name,
          },
        });
      }
    });
  },

  renameChannel: (channelId: string, newName: string): void => {
    const { socket, channels } = get();

    if (!socket) return;
    socket.emit(
      'rename-channel',
      { id: channelId, name: newName },
      (response: any) => {
        if (response.status === 'success') {
          const updatedChannels = channels.map(channel => {
            if (channel.id === channelId) {
              return { ...channel, name: newName };
            }
            return channel;
          });
          const updatedChannelGroups = get().channelGroups.map(channelGroup => {
            return {
              ...channelGroup,
              items: channelGroup.items.map(item => {
                if (item.id === channelId) {
                  return { ...item, name: newName };
                }
                return item;
              }),
            };
          });

          set({
            channels: updatedChannels,
            channelGroups: updatedChannelGroups,
          });
        }
      }
    );
  },

  onChannelRenamed: (): void => {
    const { socket } = get();

    if (!socket) return;
    socket.on('channel-renamed', (data: { id: string; name: string }) => {
      const { channels } = get();
      const updatedChannels = channels.map(channel => {
        if (channel.id === data.id) {
          return { ...channel, name: data.name };
        }
        return channel;
      });

      const updatedChannelGroups = get().channelGroups.map(channelGroup => {
        return {
          ...channelGroup,
          items: channelGroup.items.map(item => {
            if (item.id === data.id) {
              return { ...item, name: data.name };
            }
            return item;
          }),
        };
      });

      set({ channels: updatedChannels, channelGroups: updatedChannelGroups });
    });
  },

  leaveChannel: (id: string): void => {
    const { socket, channelGroups, channels, notesChannel } = get();

    if (!socket) return;
    socket.emit('leave-channel', id, (response: any) => {
      if (response.status === 'success') {
        const updatedChannels = channels.filter(channel => channel.id !== id);

        const updatedChannelGroups = channelGroups.map(channelGroup => ({
          ...channelGroup,
          items: channelGroup.items.filter(item => item.id !== id),
        }));

        set({
          channels: updatedChannels,
          channelGroups: updatedChannelGroups,
          currentChannel: {
            id: notesChannel.id,
            name: notesChannel.name,
          },
        });
      }
    });
  },
}));

const generateObjectId = (): string => {
  const timestamp = Math.floor(Date.now() / 1000).toString(16);
  const randomBytes = [...Array(5)]
    .map(() =>
      Math.floor(Math.random() * 256)
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
  const increment = Math.floor(Math.random() * 16777216)
    .toString(16)
    .padStart(6, '0');

  return timestamp + randomBytes + increment;
};

export default useMessengerStore;
