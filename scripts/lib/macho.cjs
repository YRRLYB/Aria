// Build-time wrapper around the runtime Mach-O inspector. Keeping the parser
// in electron/ means the packaged app can also refuse a decoder built for the
// wrong CPU without shipping the packaging scripts.
module.exports = require("../../electron/macBinary.cjs");
