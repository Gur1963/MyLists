// גרסה: V5-MULTI-OFFSET-4082026 (סמן בדיקה - אם אתה רואה את השורה הזו, הדבקת את הקובץ הנכון)
// בודק פעם ב-15 דקות את כל רשימות ה"תזכורות" בכל המשתמשים ב-Firestore,
// ושולח התראת ntfy לכל משתמש לנושא הפרטי שלו (אם יש), לפי עד 3 זמני התראה נבחרים לכל פריט
// (reminderOffsets); פריטים ישנים בלי הגדרה כזו ממשיכים לעבוד עם החלון הישן (24 עד 2 שעות לפני).

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

// תרגום מספר שעות-לפני לתווית עברית קריאה (בהתאמה לרשימה ב-mobile_list.html)
function offsetLabel(hours) {
  if (Math.abs(hours - 168) < 0.01) return 'שבוע לפני';
  if (Math.abs(hours - 72)  < 0.01) return '3 ימים לפני';
  if (Math.abs(hours - 24)  < 0.01) return 'יום לפני';
  if (Math.abs(hours - 12)  < 0.01) return 'חצי יום לפני';
  if (Math.abs(hours - 2)   < 0.01) return 'שעתיים לפני';
  if (Math.abs(hours - 1)   < 0.01) return 'שעה לפני';
  if (Math.abs(hours - 0.5) < 0.01) return 'חצי שעה לפני';
  if (hours < 1) return `${Math.round(hours * 60)} דקות לפני`;
  return `${hours} שעות לפני`;
}

async function sendPush(item, topic, offsetText) {
  const dateLabel = new Date(item.date + 'T00:00:00').toLocaleDateString('he-IL', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  let body = `בתאריך ${dateLabel} בשעה ${item.time} יש לך פגישה עם ${item.text}`;
  if (item.location) body += `\nמיקום: ${item.location}`;
  const title = offsetText ? `🔔 תזכורת לפגישה (${offsetText})` : '🔔 תזכורת לפגישה מחר';

  const res = await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Title': encodeHeaderUtf8(title),
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

  // טוען את מפת הנושאים הפרטיים (email -> ntfyTopic) מתוך config/allowed_users.
  // כל משתמש שקיבל נושא אישי (נוצר אוטומטית במסך הניהול באפליקציה) יקבל את ההתראות שלו
  // רק אליו; מי שאין לו נושא אישי (עדיין) ייפול חזרה לנושא הגלובלי הישן (NTFY_TOPIC).
  const topicMap = {};
  try {
    const configSnap = await db.collection('config').doc('allowed_users').get();
    if (configSnap.exists) {
      const allowed = configSnap.data().allowed || [];
      allowed.forEach(u => {
        if (u && u.email && u.ntfyTopic) topicMap[u.email.toLowerCase()] = u.ntfyTopic;
      });
    }
  } catch (e) {
    console.log('אזהרה: לא הצלחתי לטעון נושאים אישיים, ממשיך עם ברירת המחדל הגלובלית:', e.message);
  }

  const usersSnap = await db.collection('users').get();
  let sentCount = 0;

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data();
    if (!data.lists) continue;
    let changed = false;

    // מזהה את הנושא האישי של המשתמש הזה (לפי המייל שלו ב-Firebase Auth), אחרת ברירת מחדל גלובלית
    let userTopic = ntfyTopic;
    try {
      const authUser = await admin.auth().getUser(userDoc.id);
      if (authUser.email && topicMap[authUser.email.toLowerCase()]) {
        userTopic = topicMap[authUser.email.toLowerCase()];
      }
    } catch (e) {
      // לא הצלחנו לזהות את המייל של המשתמש הזה - נמשיך עם ברירת המחדל הגלובלית
    }

    for (const list of data.lists) {
      if (list.type !== 'reminders' || !list.items) continue;

      for (const item of list.items) {
        if (item.done) continue;
        if (!item.date || !item.time) continue;

        const when = israelToUtc(item.date, item.time);
        const diffHours = (when - now) / 3600000;

        if (Array.isArray(item.reminderOffsets) && item.reminderOffsets.length) {
          // מצב חדש: עד 3 זמני התראה נבחרים לכל פריט. כל זמן נשלח פעם אחת בלבד
          // (notifiedOffsets מונע כפילות), וכל ריצה שתופסת זמן שעדיין לא נשלח - תשלח אותו,
          // גם אם באיחור. זה עמיד בפני עיכובים בתזמון של GitHub Actions.
          const notifiedOffsets = Array.isArray(item.notifiedOffsets) ? item.notifiedOffsets : [];
          for (const offset of item.reminderOffsets) {
            const alreadySent = notifiedOffsets.some(o => Math.abs(o - offset) < 0.01);
            if (alreadySent) continue;
            if (diffHours <= offset && diffHours > 0) {
              console.log(`שולח תזכורת (${offsetLabel(offset)}): "${item.text}" (${item.date} ${item.time})`);
              await sendPush(item, userTopic, offsetLabel(offset));
              notifiedOffsets.push(offset);
              changed = true;
              sentCount++;
            }
          }
          item.notifiedOffsets = notifiedOffsets;
          const allSent = item.reminderOffsets.every(offset => notifiedOffsets.some(o => Math.abs(o - offset) < 0.01));
          if (allSent || diffHours <= 0) {
            item.done = true;
            changed = true;
          }
        } else if (!item.notified) {
          // מצב ישן (תאימות לאחור) לפריטים מלפני התכונה הזו - חלון יחיד של 24 עד שעתיים לפני.
          if (diffHours <= 24 && diffHours > 2) {
            console.log(`שולח תזכורת: "${item.text}" (${item.date} ${item.time})`);
            await sendPush(item, userTopic, null);
            item.notified = true;
            item.done = true;
            changed = true;
            sentCount++;
          } else if (diffHours <= 0) {
            // הזמן כבר עבר בלי שנשלחה התראה - מסמנים רק כ-done (בלי notified) כדי שהפריט
            // לא יישאר תקוע ברשימה כ"ממתין" לנצח. notified+done = נשלחה בפועל, done בלבד = הזמן פשוט עבר.
            console.log(`הזמן כבר עבר בלי שנשלחה התראה: "${item.text}" (${item.date} ${item.time}) - מסמן כמטופל (בלי notified)`);
            item.done = true;
            changed = true;
          }
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
