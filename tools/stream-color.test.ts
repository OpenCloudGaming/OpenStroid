import assert from 'node:assert/strict';
import { buildGatewayStatusParams } from '../src/stream/OpenStroidStreamClient.ts';

const h264 = buildGatewayStatusParams({
  maxFramerate: 60,
  maxBitrate: 20_000_000,
  cursorZip: true,
  filler: false,
  networkType: '4g',
  codec: 'h264',
});

assert.equal(h264.hdr, false, 'The WebRTC client must not request HDR from the gateway');
assert.equal('codec' in h264, false, 'H.264 remains the default codec without an explicit override');

const av1 = buildGatewayStatusParams({
  maxFramerate: 120,
  maxBitrate: 50_000_000,
  cursorZip: false,
  filler: true,
  networkType: 'unknown',
  codec: 'av1',
});

assert.equal(av1.hdr, false, 'AV1 profile 0 is also negotiated as SDR');
assert.equal(av1.codec, 'av1');
assert.equal(av1.framerate_max, 120);
assert.equal(av1.bitrate_max, 50_000_000);

console.log('Stream color negotiation checks passed.');
