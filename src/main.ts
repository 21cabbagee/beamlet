import "./style.css";
import { initReceive, leaveReceive } from "./receive";
import { initSend, leaveSend } from "./send";
import { $ } from "./ui";

type View = "home" | "send" | "receive";

function route() {
  const hash = location.hash.slice(1);
  const view: View = hash === "send" || hash === "receive" ? hash : "home";
  for (const v of ["home", "send", "receive"] as View[]) $(`view-${v}`).hidden = v !== view;
  document.querySelectorAll<HTMLAnchorElement>(".tabs a").forEach((a) => {
    if (a.dataset.tab === view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (view !== "send") leaveSend();
  if (view !== "receive") leaveReceive();
}

initSend();
initReceive();
window.addEventListener("hashchange", route);
route();
