function buildQqLoginCookie(cookies) {
  const relevant = cookies
    .filter((cookie) => /(^|\.)qq\.com$/i.test(String(cookie.domain || "").replace(/^\./, "")))
    .filter((cookie) => cookie.name && cookie.value != null && String(cookie.value));
  const values = new Map();
  for (const cookie of relevant) {
    const name = cookie.name.toLowerCase();
    if (!values.has(name)) values.set(name, String(cookie.value));
  }
  const validUin = (value) => /^\d{4,}$/.test(String(value || "").replace(/^o/i, ""));
  const wx = values.get("login_type") === "2" || (!values.get("qm_keyst") && !values.get("qqmusic_key") && values.get("wxmusic_key"));
  const key = wx ? values.get("wxmusic_key") || values.get("qm_keyst") || values.get("qqmusic_key") : values.get("qm_keyst") || values.get("qqmusic_key");
  const uin = wx ? values.get("wxuin") || values.get("uin") || values.get("p_uin") : values.get("uin") || values.get("qqmusic_uin") || values.get("p_uin");
  if (!key || !validUin(uin)) return null;
  if (wx) values.set("login_type", "2");
  return [...values].map(([name, value]) => `${name}=${value}`).join("; ");
}

module.exports = { buildQqLoginCookie };
