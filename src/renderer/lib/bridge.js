// The only place the pages touch window.ivuenu (the preload bridge).
export const call = (channel, arg) => window.ivuenu.invoke(channel, arg);
export const on = (channel, callback) => window.ivuenu.on(channel, callback);
export const send = (channel, arg) => window.ivuenu.send(channel, arg);
