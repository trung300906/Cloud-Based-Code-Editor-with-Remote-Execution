"use strict";

const { encryptPayload, decryptPayload } = require("./cryptoClient.js");

const TYPE = {
  ERR: 0x00,
  AUTH: 0x01,
  EDIT: 0x02,
  RUN: 0x03,
  CURSOR: 0x04,
  CHAT: 0x05,
  RESULT: 0x06,
  INPUT: 0x07,
  LINT: 0x08,
  FS_EVENT: 0x09,
  COLLAB: 0x0a,
  PING: 0xff,
};

function encodePayload(requestId, data) {
  const idBuf = Buffer.from(requestId || "", "utf8");
  const idLenBuf = Buffer.alloc(4);
  idLenBuf.writeUInt32BE(idBuf.length, 0);

  let dataBuf;
  if (Buffer.isBuffer(data)) {
    dataBuf = data;
  } else if (data instanceof Uint8Array || ArrayBuffer.isView(data) || data instanceof ArrayBuffer) {
    dataBuf = Buffer.from(data);
  } else {
    dataBuf = Buffer.from(
      typeof data === "object" ? JSON.stringify(data) : String(data ?? ""),
      "utf8",
    );
  }

  return Buffer.concat([idLenBuf, idBuf, dataBuf]);
}

function decodePayload(payload) {
  if (!Buffer.isBuffer(payload) || payload.length < 4) return null;
  const idLen = payload.readUInt32BE(0);
  if (payload.length < 4 + idLen) return null;

  const requestId = payload.subarray(4, 4 + idLen).toString("utf8");
  const dataBuf = payload.subarray(4 + idLen);
  const dataText = dataBuf.toString("utf8");

  let data = dataText;
  try {
    data = JSON.parse(dataText);
  } catch (_) {}

  return { requestId, data, dataBuf };
}

function buildFrame(type, requestId, data, opts = {}) {
  const plainPayload = encodePayload(requestId, data);
  const payload = opts.encrypt ? encryptPayload(plainPayload) : plainPayload;

  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 0);
  header.writeUInt8(type, 4);

  return Buffer.concat([header, payload]);
}

function parseFrame(rawFrame) {
  if (!Buffer.isBuffer(rawFrame) || rawFrame.length < 5) return null;
  const len = rawFrame.readUInt32BE(0);
  const type = rawFrame.readUInt8(4);
  if (rawFrame.length < 5 + len) return null;
  const payload = rawFrame.subarray(5, 5 + len);
  return { len, type, payload };
}

function decodeFramePayload(type, payload, opts = {}) {
  let plain = payload;
  if (opts.decrypt) {
    plain = decryptPayload(payload);
  }

  return decodePayload(plain);
}

module.exports = {
  TYPE,
  buildFrame,
  parseFrame,
  decodeFramePayload,
  encodePayload,
};
