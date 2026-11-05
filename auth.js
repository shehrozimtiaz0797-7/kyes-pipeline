'use strict';
// One-time YouTube connection. Run:  node auth.js
const { login } = require('./src/youtube');
login().then(() => process.exit(0)).catch(err => { console.error('\n✗ ' + err.message + '\n'); process.exit(1); });
