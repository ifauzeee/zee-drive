// Pre-paint theme init: set data-theme sebelum CSS render (cegah FOUC).
// File terpisah (bukan inline) supaya tidak diblokir CSP script-src 'self'.
document.documentElement.dataset.theme = localStorage.getItem("zi-theme") || "dark";