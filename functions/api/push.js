import { sendPush } from '../../../lib/send-push.mjs';

export async function onRequestPost(context) {
  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  const subscriptions = Array.isArray(payload.subscriptions) ? payload.subscriptions.slice(0, 20) : [];
  const message = {
    title: String(payload.title || 'Task assigned to you').slice(0, 80),
    body: String(payload.body || 'New task').slice(0, 180),
    tag: String(payload.tag || 'reny-task').slice(0, 80),
  };
  const results = [];
  for (const subscription of subscriptions) {
    try {
      results.push(await sendPush(subscription, message));
    } catch (error) {
      results.push(error instanceof Error ? error.message : 'failed');
    }
  }
  return Response.json({ ok: true, results });
}
