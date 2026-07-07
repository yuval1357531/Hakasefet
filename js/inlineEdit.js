// Shared "click pencil -> inline input -> save" affordance, used across
// every content page (dashboard home, section/course/lesson viewers, vault
// and freedom home/lesson pages) when the master is in edit mode. Keeps the
// same page-local render()-then-reload pattern already used everywhere else
// in this app: on save or cancel, the caller's own async rerender() is
// called to redraw from fresh data, rather than patching the DOM by hand.

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// id/field identify what to save (passed back to onSave untouched); value is
// the current display text; multiline renders a textarea instead of input.
export function editableField(id, field, value, { multiline = false } = {}) {
  return `<span class="editable-wrap" data-editable data-edit-id="${escapeHtml(id)}" data-edit-field="${field}" data-multiline="${multiline ? '1' : ''}">
    <span class="editable-text">${escapeHtml(value)}</span>
    <button type="button" class="edit-pencil" title="עריכה" aria-label="עריכה">✎</button>
  </span>`;
}

// Scans the container for editableField() spans and wires the click-to-edit
// behavior. onSave(id, field, newValue) is awaited, then rerender() is
// always called afterward (whether saved or cancelled) to redraw fresh.
export function wireEditableFields(container, { onSave, rerender }) {
  container.querySelectorAll('[data-editable]').forEach((wrap) => {
    const pencil = wrap.querySelector('.edit-pencil');
    if (!pencil) return;

    pencil.addEventListener('click', (e) => {
      // Editable fields commonly sit inside a clickable card/row (<a> to a
      // detail page) -- never let entering edit mode also trigger that nav.
      e.preventDefault();
      e.stopPropagation();
      if (wrap.querySelector('.editable-input')) return;

      const textEl = wrap.querySelector('.editable-text');
      const current = textEl.textContent;
      const multiline = wrap.dataset.multiline === '1';
      const id = wrap.dataset.editId;
      const field = wrap.dataset.editField;

      const input = document.createElement(multiline ? 'textarea' : 'input');
      input.className = 'editable-input';
      input.value = current;
      if (multiline) input.rows = 3;

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'edit-save';
      saveBtn.title = 'שמירה';
      saveBtn.textContent = '✓';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'edit-cancel';
      cancelBtn.title = 'ביטול';
      cancelBtn.textContent = '✕';

      textEl.replaceWith(input);
      pencil.replaceWith(saveBtn);
      saveBtn.after(cancelBtn);
      input.focus();
      if (input.select) input.select();

      let settled = false;
      async function commit() {
        if (settled) return;
        settled = true;
        const newValue = input.value.trim();
        if (newValue && newValue !== current) {
          await onSave(id, field, newValue);
        }
        await rerender();
      }
      async function discard() {
        if (settled) return;
        settled = true;
        await rerender();
      }

      saveBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        commit();
      });
      cancelBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        discard();
      });
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !multiline) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          discard();
        }
      });
    });
  });
}

// Small ↑/↓ reorder button pair, same look everywhere it appears.
export function reorderButtonsHTML(id) {
  return `
    <button type="button" class="btn-ghost small reorder-btn" data-reorder-id="${escapeHtml(id)}" data-reorder-dir="up" title="הזז למעלה">↑</button>
    <button type="button" class="btn-ghost small reorder-btn" data-reorder-id="${escapeHtml(id)}" data-reorder-dir="down" title="הזז למטה">↓</button>`;
}

export function wireReorderButtons(container, { onMove, rerender }) {
  container.querySelectorAll('.reorder-btn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await onMove(btn.dataset.reorderId, btn.dataset.reorderDir);
      await rerender();
    });
  });
}
