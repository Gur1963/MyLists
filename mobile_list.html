// בודק פעם ב-15 דקות את כל רשימות ה"תזכורות" בכל המשתמשים ב-Firestore,
// ושולח התראת ntfy יום (24 שעות) לפני כל פגישה שעדיין לא נשלחה עליה התראה.

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const ntfyTopic = process.env.NTFY_TOPIC;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// ממיר תאריך+שעה כפי שהוזנו (לפי שעון ישראל) לזמן UTC אמיתי,
// כולל טיפול אוטומטי במעבר שעון קיץ/חורף.
function israelToUtc(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  dtf.formatToParts(new Date(guess)).forEach(p => { parts[p.type] = p.value; });
  const asUtcOfLocal = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  );
  const offset = asUtcOfLocal - guess;
  return new Date(guess - offset);
}

// קידוד RFC 2047 לכותרת HTTP שמכילה עברית, כדי שזה יעבוד בכל הלקוחות
function encodeHeaderUtf8(text) {
  const b64 = Buffer.from(text, 'utf8').toString('base64');
  return `=?UTF-8?B?${b64}?=`;
}

async function sendPush(item) {
  const dateLabel = new Date(item.date + 'T00:00:00').toLocaleDateString('he-IL', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  let body = `בתאריך ${dateLabel} בשעה ${item.time} יש לך פגישה עם ${item.text}`;
  if (item.location) body += `\nמיקום: ${item.location}`;

  const res = await fetch(`https://ntfy.sh/${ntfyTopic}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Title': encodeHeaderUtf8('🔔 תזכורת לפגישה מחר'),
      'Priority': '4',
      'Tags': 'bell',
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`ntfy שגיאה: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const now = new Date();
  const usersSnap = await db.collection('users').get();
  let sentCount = 0;

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    if (!data.lists) continue;
    let changed = false;

    for (const list of data.lists) {
      if (list.type !== 'reminders' || !list.items) continue;

      for (const item of list.items) {
        if (item.done || item.notified) continue;
        if (!item.date || !item.time) continue;

        const when = israelToUtc(item.date, item.time);
        const diffHours = (when - now) / 3600000;

        // חלון של 21-24 שעות לפני הפגישה - נותן מרווח ביטחון מול עיכובים
        // אפשריים בתזמון של GitHub Actions, בזמן שדגל ה-notified מונע כפילויות.
        if (diffHours <= 24 && diffHours > 21) {
          console.log(`שולח תזכורת: "${item.text}" (${item.date} ${item.time})`);
          await sendPush(item);
          item.notified = true;
          changed = true;
          sentCount++;
        }
      }
    }

    if (changed) {
      await userDoc.ref.set(data);
    }
  }

  console.log(`סיום. נשלחו ${sentCount} התראות.`);
}

main().catch(err => {
  console.error('שגיאה כללית:', err);
  process.exit(1);
});
