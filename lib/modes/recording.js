import fs from 'fs';
import path from 'path';
import { joinMeetAsGuest } from '../meet-join.js';

export async function runRecordingMode({
  browser,
  page,
  config,
  outputFile,
  writeStream,
}) {
  await page.evaluateOnNewDocument(() => {
    console.log('[hook] Installing RTCPeerConnection wrapper');
    window.__remoteStream = new MediaStream();

    const OriginalRTCPeerConnection = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...args) {
      const pc = new OriginalRTCPeerConnection(...args);
      pc.addEventListener('track', (event) => {
        console.log('[hook] Remote track:', event.track.kind, event.track.id);
        window.__remoteStream.addTrack(event.track);
      });
      return pc;
    };
    window.RTCPeerConnection.prototype = OriginalRTCPeerConnection.prototype;
    console.log('[hook] Installed');
  });

  await page.exposeFunction('saveChunk', (chunkArray) => {
    writeStream.write(Buffer.from(chunkArray));
  });
  await page.exposeFunction('finishRecording', () => {
    writeStream.end();
    console.log('[bot] Recording flushed to disk:', outputFile);
  });

  await joinMeetAsGuest(page, {
    meetUrl: config.meetUrl,
    botName: config.botName,
    joinTimeoutMs: config.joinTimeoutMs,
    outputDir: config.outputDir,
  });

  console.log(`[bot] Waiting ${config.admitWaitMs}ms for host admit and remote tracks...`);
  await new Promise((resolve) => setTimeout(resolve, config.admitWaitMs));

  const trackCount = await page.evaluate(() => window.__remoteStream?.getTracks().length || 0);
  console.log(`[bot] Remote stream has ${trackCount} track(s)`);

  if (trackCount === 0) {
    console.log('[bot] WARN: no remote tracks. Bot may not be admitted, or host has camera/mic off.');
  }

  console.log(`[bot] Recording for ${config.recordSeconds}s...`);
  await page.evaluate((seconds) => {
    return new Promise((resolve, reject) => {
      const stream = window.__remoteStream;
      const tracks = stream.getTracks();
      console.log(`[recorder] Stream has ${tracks.length} tracks:`);
      tracks.forEach((track, index) => {
        console.log(
          `  Track ${index}: kind=${track.kind}, readyState=${track.readyState}, enabled=${track.enabled}, muted=${track.muted}`,
        );
      });

      const activeTracks = tracks.filter((track) => track.readyState === 'live');
      console.log(`[recorder] Active tracks: ${activeTracks.length}`);

      if (activeTracks.length === 0) {
        console.log('[recorder] No active tracks, aborting');
        resolve();
        return;
      }

      const recordStream = new MediaStream(activeTracks);
      const recorder = new MediaRecorder(recordStream, {
        mimeType: 'video/webm;codecs=vp8,opus',
      });

      let chunkCount = 0;
      recorder.ondataavailable = async (event) => {
        console.log(`[recorder] dataavailable: size=${event.data.size}`);
        if (event.data.size > 0) {
          chunkCount += 1;
          const buffer = await event.data.arrayBuffer();
          const arr = Array.from(new Uint8Array(buffer));
          await window.saveChunk(arr);
        }
      };

      recorder.onstop = async () => {
        console.log(`[recorder] stopped, total chunks: ${chunkCount}`);
        await window.finishRecording();
        resolve();
      };

      recorder.onerror = (event) => {
        console.log('[recorder] ERROR:', event.error?.message);
        reject(event);
      };

      recorder.start(1000);
      console.log('[recorder] Started, state:', recorder.state);

      setTimeout(() => {
        console.log('[recorder] Stopping, state:', recorder.state);
        recorder.stop();
      }, seconds * 1000);
    });
  }, config.recordSeconds);

  console.log('[bot] Capturing raw VideoFrames via MediaStreamTrackProcessor...');
  const frameMetadata = await page.evaluate(async (seconds) => {
    const videoTracks = window.__remoteStream
      .getVideoTracks()
      .filter((track) => track.readyState === 'live');

    if (videoTracks.length === 0) {
      console.log('[trackproc] No live video tracks; skipping.');
      return [];
    }

    const track = videoTracks[0];
    console.log('[trackproc] Tapping video track:', track.id);

    const processor = new MediaStreamTrackProcessor({ track });
    const reader = processor.readable.getReader();

    const meta = [];
    const deadline = Date.now() + seconds * 1000;
    let count = 0;

    while (Date.now() < deadline) {
      const { value: frame, done } = await reader.read();
      if (done) break;

      meta.push({
        i: count,
        ts: frame.timestamp,
        codedWidth: frame.codedWidth,
        codedHeight: frame.codedHeight,
        format: frame.format,
        duration: frame.duration,
      });
      count += 1;
      frame.close();
    }

    reader.cancel();
    console.log('[trackproc] Captured', count, 'raw frames');
    return meta;
  }, 5);

  const framesPath = path.join(config.outputDir, `frames-${Date.now()}.jsonl`);
  fs.writeFileSync(
    framesPath,
    `${frameMetadata.map((frame) => JSON.stringify(frame)).join('\n')}\n`,
  );
  console.log('[bot] Wrote', frameMetadata.length, 'frame records to', framesPath);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  console.log('[bot] Done. Output:', outputFile);
}
