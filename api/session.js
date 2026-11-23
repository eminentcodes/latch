import { handleSession } from '../dist/src/hosting/handler.js';
import build from './build-info.json' with {type: 'json'};

export default async function session(request, response) {
  await handleSession(request, response, {sourceRef: build.sourceRef});
}
