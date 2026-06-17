import { handleListModels } from "../../lib/shared.js";

async function onRequest(context) {
  return handleListModels(context);
}

export { onRequest };
export default onRequest;
