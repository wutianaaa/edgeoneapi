import { handleAdminRequest } from "../../lib/shared.js";

async function onRequest(context) {
  return handleAdminRequest(context);
}

export { onRequest };
export default onRequest;
