// The only bridge between the web pages and the computer. The pages get four functions and nothing else:
// they cannot read files, start programs or open sockets. Every call goes to one handler table in the main process.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['import:progress', 'voices:progress', 'rec:state', 'rec:segment', 'rec:levels', 'data:changed', 'settings:changed', 'licence:changed',
  'island:mode', 'navigate', 'app:quit-blocked', 'dictation:state', 'audio:flush', 'refine:progress', 'refine:decode']);
const SENDS = new Set(['rec:levels', 'dictation:levels', 'island:expand', 'island:collapse', 'island:open-main', 'island:toggle',
  'win:minimize', 'win:maximize', 'win:close']);

contextBridge.exposeInMainWorld('ivuenu', {
  platform: process.platform,

  /**
   * Call a handler. Rejects with an object that has .code, .message and any extra details (status...).
   * It is a plain object on purpose: an Error loses every property except its message when it crosses this bridge, which used to
   * turn every specific message ("confirm your email first", "payments are not connected") into a generic one.
   */
  async invoke(channel, arg) {
    const res = await ipcRenderer.invoke('ivuenu:call', channel, arg);
    if (res && res.error) {
      throw { ...(res.error.extra || {}), code: res.error.code, message: res.error.message }; // eslint-disable-line no-throw-literal
    }
    return res.value;
  },

  /** Fire-and-forget messages (audio levels, island buttons). */
  send(channel, arg) { if (SENDS.has(channel)) ipcRenderer.send(channel, arg); },

  /** Listen to events pushed by the main process. Returns a function that stops listening. */
  on(channel, callback) {
    if (!EVENTS.has(channel)) return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
