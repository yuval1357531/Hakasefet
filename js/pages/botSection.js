// Jaurius Bot section: a regular chat UI for every user (mountBotHome),
// plus -- in edit mode only, same page -- a knowledge-base management
// panel where the master pastes texts/instructions, uploads files, and
// adds recording transcripts that the bot should learn from.
//
// NOTE: there is no real AI model wired in yet. The chat currently replies
// with a fixed acknowledgement placeholder -- connecting a real language
// model (choice of provider + API key + a server-side function to keep
// the key off the client) is a separate decision for the project owner
// and is intentionally not implemented here. The knowledge base itself is
// fully functional and ready for a future bot backend to read from.

import { auth } from '../auth.js';
import { botKnowledgeStore } from '../data/botKnowledgeStore.js';
import { contentStore } from '../data/contentStore.js';
import { editableField, wireEditableFields } from '../inlineEdit.js';
import { accordionHTML, wireAccordions } from '../adminAccordion.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const PLACEHOLDER_REPLIES = [
  'אני עדיין בתהליך למידה מבסיס הידע שהוזן לי, ובקרוב אוכל לענות במדויק יותר על שאלות כאלה.',
  'תודה על ההודעה! ג׳אוריוס שומר אותה, וברגע שיחובר מנוע שיחה מלא הוא ידע להגיב לעומק.',
  'קיבלתי. כרגע אני עונה בצורה בסיסית בלבד -- בקרוב אשתפר בעזרת בסיס הידע שהמאסטר מזין.',
];

function chatKey(session) {
  return `jaurius_chat_${session.id}`;
}

function loadMessages(session) {
  try {
    const raw = sessionStorage.getItem(chatKey(session));
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveMessages(session, messages) {
  sessionStorage.setItem(chatKey(session), JSON.stringify(messages));
}

function chatHTML(messages) {
  const bubbles = messages
    .map(
      (m) => `<div class="chat-bubble ${m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-bot'}">${escapeHtml(m.text)}</div>`
    )
    .join('');
  return `
    <div class="panel-card chat-panel">
      <h2 class="form-title">שיחה עם ג׳אוריוס</h2>
      <div class="chat-log" id="chatLog">${bubbles || '<p class="placeholder-desc">התחל שיחה עם ג׳אוריוס...</p>'}</div>
      <form id="chatForm" class="chat-form" novalidate>
        <input type="text" id="chatInput" placeholder="כתוב הודעה..." autocomplete="off">
        <button type="submit" class="btn-gold">שליחה</button>
      </form>
    </div>`;
}

function knowledgeListHTML(items) {
  const labels = { text: 'טקסט', file: 'קובץ', transcript: 'תמלול' };
  const rows = items
    .map(
      (i) => `
      <tr data-id="${i.id}">
        <td><span class="badge badge-gold">${labels[i.type] || i.type}</span></td>
        <td>${escapeHtml(i.title || '(ללא כותרת)')}</td>
        <td class="actions-cell">
          ${i.type === 'file' ? '<button type="button" class="btn-ghost small" data-kb-action="download">הורדה</button>' : ''}
          <button type="button" class="btn-ghost small danger" data-kb-action="delete">מחיקה</button>
        </td>
      </tr>`
    )
    .join('');

  return `
    <p class="placeholder-desc">חומרים אלו ישמשו בעתיד את ג׳אוריוס כדי להשתפר בתשובותיו.</p>

      <div class="form-grid">
        <div>
          <h3 class="form-title" style="font-size:14px;">הוספת טקסט / הנחיה</h3>
          <form id="kbTextForm" novalidate>
            <div class="field-group">
              <label for="kbTextTitle">כותרת</label>
              <input type="text" id="kbTextTitle" placeholder="לדוגמה: טון דיבור">
            </div>
            <div class="field-group">
              <label for="kbTextContent">תוכן</label>
              <textarea id="kbTextContent" rows="4" placeholder="הדבק כאן טקסט או הנחיה ארוכה..."></textarea>
            </div>
            <div class="form-actions"><button type="submit" class="btn-gold">הוספה</button></div>
          </form>
        </div>

        <div>
          <h3 class="form-title" style="font-size:14px;">העלאת קובץ</h3>
          <form id="kbFileForm" novalidate>
            <div class="field-group">
              <label for="kbFileInput">בחר קובץ</label>
              <input type="file" id="kbFileInput">
            </div>
            <div class="form-actions"><button type="submit" class="btn-gold">העלאה</button></div>
          </form>
        </div>

        <div>
          <h3 class="form-title" style="font-size:14px;">הקלטה / תמלול</h3>
          <form id="kbTranscriptForm" novalidate>
            <div class="field-group">
              <label for="kbTrTitle">כותרת</label>
              <input type="text" id="kbTrTitle" placeholder="לדוגמה: שיחת ייעוץ 12.5">
            </div>
            <div class="field-group">
              <label for="kbTrContent">תמלול</label>
              <textarea id="kbTrContent" rows="4" placeholder="הדבק כאן את התמלול..."></textarea>
            </div>
            <div class="form-actions"><button type="submit" class="btn-gold">הוספה</button></div>
          </form>
        </div>
      </div>

      <div class="error-msg" id="kbError" role="alert"></div>

      <div class="table-scroll">
        <table class="users-table">
          <thead><tr><th>סוג</th><th>כותרת</th><th>פעולות</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="3">עדיין לא נוספו חומרים.</td></tr>'}</tbody>
        </table>
      </div>`;
}

export async function mountBotHome(container, section, session) {
  // Which collapsible management panels are open -- kept across re-renders
  // (submitting a knowledge-base form re-renders the whole page).
  const openAccordions = new Set();
  // Section title/description live in the same 'sections' table every
  // other main page reads from (contentStore.sections) -- same
  // editableField pattern as vaultSection.js/freedomSection.js, so edit
  // mode gets a consistent pencil here too.
  let sectionRecord = null;

  async function render() {
    const editMode = auth.isEditMode();
    sectionRecord = await contentStore.sections.getById(section.id);
    const label = (sectionRecord && sectionRecord.title) || section.label;
    const description = (sectionRecord && sectionRecord.description) || section.description;
    const messages = loadMessages(session);
    const knowledgeHTML = editMode
      ? accordionHTML(
          'bot-knowledge',
          'ניהול בסיס הידע של הבוט',
          knowledgeListHTML(await botKnowledgeStore.getAll()),
          { isOpen: openAccordions.has('bot-knowledge') }
        )
      : '';

    const titleHTML = editMode ? editableField(section.id, 'title', label) : escapeHtml(label);
    const descHTML = editMode
      ? editableField(section.id, 'description', description, { multiline: true })
      : escapeHtml(description);

    container.innerHTML = `
      <div class="admin-page">
        <div class="admin-page-header">
          <h1 class="gold-title placeholder-title">${titleHTML}</h1>
          <p class="placeholder-desc">${descHTML}</p>
        </div>
        ${chatHTML(messages)}
        ${knowledgeHTML}
      </div>`;

    wireEditableFields(container, {
      onSave: async (id, field, value) => {
        const updated = await contentStore.sections.update(id, { [field]: value });
        if (updated) sectionRecord = updated;
      },
      rerender: render,
    });

    const chatLog = container.querySelector('#chatLog');
    const chatForm = container.querySelector('#chatForm');
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = container.querySelector('#chatInput');
      const text = input.value.trim();
      if (!text) return;

      const current = loadMessages(session);
      current.push({ role: 'user', text });
      const reply = PLACEHOLDER_REPLIES[Math.floor(Math.random() * PLACEHOLDER_REPLIES.length)];
      current.push({ role: 'bot', text: reply });
      saveMessages(session, current);

      input.value = '';
      chatLog.innerHTML = current
        .map((m) => `<div class="chat-bubble ${m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-bot'}">${escapeHtml(m.text)}</div>`)
        .join('');
      chatLog.scrollTop = chatLog.scrollHeight;
    });
    chatLog.scrollTop = chatLog.scrollHeight;
    wireAccordions(container, { state: openAccordions, rerender: render });

    if (!editMode) return;

    const errorEl = container.querySelector('#kbError');
    function showError(text) {
      errorEl.textContent = text;
      errorEl.classList.add('show');
    }

    container.querySelector('#kbTextForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = container.querySelector('#kbTextTitle').value.trim();
      const content = container.querySelector('#kbTextContent').value.trim();
      if (!content) {
        showError('יש להזין תוכן לטקסט.');
        return;
      }
      await botKnowledgeStore.createText(title, content);
      await render();
    });

    container.querySelector('#kbFileForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fileInput = container.querySelector('#kbFileInput');
      const file = fileInput.files && fileInput.files[0];
      if (!file) {
        showError('יש לבחור קובץ להעלאה.');
        return;
      }
      const result = await botKnowledgeStore.createFile(file);
      if (!result) {
        showError('שגיאה בהעלאת הקובץ.');
        return;
      }
      await render();
    });

    container.querySelector('#kbTranscriptForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = container.querySelector('#kbTrTitle').value.trim();
      const content = container.querySelector('#kbTrContent').value.trim();
      if (!content) {
        showError('יש להזין תוכן לתמלול.');
        return;
      }
      await botKnowledgeStore.createTranscript(title, content);
      await render();
    });

    container.querySelectorAll('[data-kb-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.closest('tr').dataset.id;
        const items = await botKnowledgeStore.getAll();
        const item = items.find((i) => i.id === id);
        if (!item) return;
        const action = btn.dataset.kbAction;

        if (action === 'delete') {
          if (!window.confirm('למחוק את הפריט מבסיס הידע?')) return;
          await botKnowledgeStore.remove(item);
          await render();
        } else if (action === 'download') {
          const url = await botKnowledgeStore.getFileDownloadUrl(item.fileUrl);
          if (url) window.open(url, '_blank');
        }
      });
    });
  }

  await render();
}
