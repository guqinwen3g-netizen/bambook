const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'components/ui/SpotlightCard.tsx');
let content = fs.readFileSync(file, 'utf8');

// The replacement logic will be complex. I will just rewrite the whole file using a template string.
