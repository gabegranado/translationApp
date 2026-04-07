require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const readline = require('readline');
const { execSync } = require('child_process');
const Message = require('./models/Message');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeShell(str) {
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

function checkAccessibility() {
  try {
    const result = execSync(`python3 -c "
import Quartz
e = Quartz.CGEventCreateKeyboardEvent(None, 0, True)
Quartz.CGEventPost(Quartz.kCGSessionEventTap, e)
print('ok')
"`, { encoding: 'utf-8', timeout: 5000 });
    return result.trim() === 'ok';
  } catch {
    return false;
  }
}

function typeAndEnter(text) {
  // All-in-one: copy to clipboard, paste, press Enter — single python call
  execSync(`printf '%s' ${escapeShell(text)} | pbcopy`);
  execSync(`python3 -c "
import Quartz, time

time.sleep(0.15)

# Cmd+V paste
src = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateHIDSystemState)
down = Quartz.CGEventCreateKeyboardEvent(src, 9, True)
up = Quartz.CGEventCreateKeyboardEvent(src, 9, False)
Quartz.CGEventSetFlags(down, Quartz.kCGEventFlagMaskCommand)
Quartz.CGEventSetFlags(up, Quartz.kCGEventFlagMaskCommand)
Quartz.CGEventPost(Quartz.kCGSessionEventTap, down)
time.sleep(0.05)
Quartz.CGEventPost(Quartz.kCGSessionEventTap, up)
time.sleep(0.3)

# Return
src2 = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateHIDSystemState)
down2 = Quartz.CGEventCreateKeyboardEvent(src2, 36, True)
up2 = Quartz.CGEventCreateKeyboardEvent(src2, 36, False)
Quartz.CGEventPost(Quartz.kCGSessionEventTap, down2)
time.sleep(0.05)
Quartz.CGEventPost(Quartz.kCGSessionEventTap, up2)
time.sleep(0.15)
"`, { timeout: 10000 });
}

function clickAtMouse() {
  execSync(`python3 -c "
import Quartz, time
src = Quartz.CGEventSourceCreate(Quartz.kCGEventSourceStateHIDSystemState)
pos = Quartz.CGEventGetLocation(Quartz.CGEventCreate(None))
down = Quartz.CGEventCreateMouseEvent(src, Quartz.kCGEventLeftMouseDown, pos, Quartz.kCGMouseButtonLeft)
up = Quartz.CGEventCreateMouseEvent(src, Quartz.kCGEventLeftMouseUp, pos, Quartz.kCGMouseButtonLeft)
Quartz.CGEventPost(Quartz.kCGSessionEventTap, down)
time.sleep(0.05)
Quartz.CGEventPost(Quartz.kCGSessionEventTap, up)
time.sleep(0.3)
"`, { timeout: 5000 });
}

async function main() {
  // Check Accessibility permissions before doing anything
  console.log('Checking Accessibility permissions...');
  if (!checkAccessibility()) {
    console.log('\n*** Accessibility permission required ***');
    console.log('Your terminal app needs permission to control your computer.');
    console.log('');
    console.log('  1. Open System Settings > Privacy & Security > Accessibility');
    console.log('  2. Click the + button');
    console.log('  3. Add your terminal app (Terminal, iTerm2, VS Code, etc.)');
    console.log('  4. Make sure the toggle is ON');
    console.log('  5. Restart your terminal and try again');
    console.log('');
    process.exit(1);
  }
  console.log('Permissions OK.\n');

  await mongoose.connect(process.env.MONGO_URI);

  // Get start time
  let startTime;
  while (true) {
    const time = await ask('Enter start time (HH:MM): ');
    if (/^\d{2}:\d{2}$/.test(time)) {
      const [h, m] = time.split(':').map(Number);
      if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
        startTime = time;
        break;
      }
    }
    console.log('Invalid format. Use HH:MM (e.g. 09:30 or 14:00)');
  }

  // Get date
  let startDate;
  while (true) {
    const date = await ask('Enter date (DD/MM/YYYY): ');
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
      const [day, month, year] = date.split('/').map(Number);
      const parsed = new Date(year, month - 1, day);
      if (parsed.getDate() === day && parsed.getMonth() === month - 1 && parsed.getFullYear() === year) {
        startDate = date;
        break;
      }
    }
    console.log('Invalid format. Use DD/MM/YYYY (e.g. 25/12/2025)');
  }

  // Build the start datetime
  const [day, month, year] = startDate.split('/').map(Number);
  const [startH, startM] = startTime.split(':').map(Number);
  const from = new Date(year, month - 1, day, startH, startM, 0, 0);

  // Build end of that day
  const to = new Date(year, month - 1, day, 23, 59, 59, 999);

  // Fetch messages in range
  const messages = await Message.find({
    timestamp: { $gte: from, $lte: to },
  }).sort({ timestamp: 1 }).lean();

  if (messages.length === 0) {
    console.log(`\nNo messages found from ${startTime} on ${startDate}.`);
    rl.close();
    await mongoose.disconnect();
    return;
  }

  console.log(`\nFound ${messages.length} message(s) from ${startTime} on ${startDate}.\n`);

  // Show preview
  for (const msg of messages) {
    const t = new Date(msg.timestamp);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    console.log(`${msg.sender} ${hh}:${mm} "${msg.englishText}"`);
  }

  console.log('');
  const confirm = await ask('Proceed? (y/n): ');
  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.');
    rl.close();
    await mongoose.disconnect();
    return;
  }

  // Countdown — give user 5 seconds to position mouse
  for (let i = 5; i > 0; i--) {
    process.stdout.write(`\rMove your mouse to the target... ${i}s `);
    await sleep(1000);
  }
  console.log('\rStarting...                              ');

  // Click where the mouse is
  clickAtMouse();
  await sleep(300);

  // Type each message, press Enter after each
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const t = new Date(msg.timestamp);
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const line = `${msg.sender} ${hh}:${mm} "${msg.englishText}"`;

    typeAndEnter(line);
    await sleep(400);
  }

  console.log('Done.');
  rl.close();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
