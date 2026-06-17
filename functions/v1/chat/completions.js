import { handleChatCompletions } from "../../../lib/shared.js";

async function onRequest(context) {
  return handleChatCompletions(context);
}

export { onRequest };
export default onRequest;
