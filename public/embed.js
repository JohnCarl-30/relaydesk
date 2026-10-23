/*
 * Relaydesk widget loader. On a business's own site:
 *
 *   <script src="https://YOUR-RELAYDESK-HOST/embed.js" data-business="acme" async></script>
 *
 * It adds one iframe pointing at /embed/<business> and resizes it when the
 * widget opens or closes. The iframe holds all chat state, so the host page
 * never sees conversations.
 */
(function () {
  var script = document.currentScript;
  var business = script && script.getAttribute("data-business");
  if (!business) {
    console.error("Relaydesk: add data-business=\"your-business-id\" to the embed script tag.");
    return;
  }
  var origin = new URL(script.src).origin;

  var frame = document.createElement("iframe");
  frame.src = origin + "/embed/" + encodeURIComponent(business);
  frame.title = "Support chat";
  frame.setAttribute("data-relaydesk", business);
  frame.style.cssText =
    "position:fixed;right:0;bottom:0;border:0;background:transparent;color-scheme:normal;z-index:2147483000;";

  function size(open) {
    var narrow = window.innerWidth < 640;
    if (open && narrow) {
      frame.style.width = "100vw";
      frame.style.height = "100dvh";
    } else if (open) {
      frame.style.width = "420px";
      frame.style.height = "min(720px, 100dvh)";
    } else {
      frame.style.width = "96px";
      frame.style.height = "96px";
    }
  }
  var isOpen = false;
  size(isOpen);

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.type !== "relaydesk:widget") return;
    isOpen = Boolean(data.open);
    size(isOpen);
  });
  window.addEventListener("resize", function () {
    size(isOpen);
  });

  function mount() {
    document.body.appendChild(frame);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
