/*
 * Email address, assembled in the browser so it never appears as plain text
 * in the HTML. Fill in both parts to publish it; every [data-email-slot]
 * element then becomes a mailto link. While either part is empty, the slots
 * keep their placeholder content.
 */
(function () {
  "use strict";

  const USER = "";
  const DOMAIN = "";

  if (!USER || !DOMAIN) return;
  const address = USER + "@" + DOMAIN;

  document.querySelectorAll("[data-email-slot]").forEach((slot) => {
    const link = document.createElement("a");
    link.href = "mailto:" + address;
    if (slot.closest(".id-links")) {
      link.setAttribute("aria-label", "Email");
      link.title = address;
      link.innerHTML = '<i class="bi bi-envelope" aria-hidden="true"></i>';
    } else {
      link.textContent = address;
    }
    slot.replaceChildren(link);
  });
})();
