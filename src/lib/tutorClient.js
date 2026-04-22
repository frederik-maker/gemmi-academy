// Thin shim that picks the right tutor provider and yields its events to the
// caller. All the streaming and tool-routing logic lives in tutorProviders.js;
// this file's only job is to abstract "which agent runtime are we talking to".

import { selectProvider } from './tutorProviders.js'

export async function* streamTutor({ messages, studentState, signal, preferred }) {
  const provider = await selectProvider({ preferred })
  if (!provider) {
    yield { kind: 'error', message: 'no_tutor_available' }
    return
  }
  yield { kind: 'provider', id: provider.id, name: provider.name, needsNetwork: provider.needsNetwork }
  yield* provider.streamReply({ messages, studentState, signal })
}
