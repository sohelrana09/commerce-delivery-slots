import { handlers } from "../handlers.js";
import { adminAction } from "../http.js";

export const main = adminAction("profiles-list", handlers.profilesList);
