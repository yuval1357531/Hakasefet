// Shared collapsible wrapper for admin/edit-mode management panels (ticker
// phrase management, add-lesson forms, comment moderation, bot knowledge
// base, personal-area news composer, ...). Each panel starts collapsed;
// clicking its title toggles it open/closed in place, no navigation, no
// reload. Open/closed state is tracked by the CALLER (a small Set closured
// inside that page's mount function -- see openAccordionIds pattern in
// vaultSection.js etc.) so it survives that page's own re-renders but
// resets naturally on navigation, exactly like the existing editingId
// pattern already used for inline editing.

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Wraps `bodyHTML` in a panel-card with a clickable title-row header and a
// collapsible body. `titleClass` lets callers match whichever heading style
// the surrounding page already uses for that block (.form-title on most
// admin panels, .personal-block-title on the personal-area cards) so the
// collapsed/expanded title reads identically to before -- only a chevron
// and click behaviour are added.
// `badgeCount`: an optional small red count badge next to the title (e.g.
// pending comments awaiting approval) -- see .admin-badge in dashboard.css.
export function accordionHTML(id, title, bodyHTML, { isOpen = false, titleClass = 'form-title', extraCardClass = '', badgeCount = 0 } = {}) {
  const badgeHTML = badgeCount > 0 ? `<span class="admin-badge">${badgeCount}</span>` : '';
  return `
    <div class="panel-card admin-accordion ${isOpen ? 'is-open' : ''} ${extraCardClass}" data-accordion-id="${id}">
      <button type="button" class="${titleClass} admin-accordion-header" data-accordion-toggle="${id}" aria-expanded="${isOpen}">
        <span>${escapeHtml(title)}${badgeHTML}</span>
        <span class="admin-accordion-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="admin-accordion-body" ${isOpen ? '' : 'hidden'}>${bodyHTML}</div>
    </div>`;
}

// `state` is a plain Set<string> of currently-open accordion ids, owned by
// the caller's render closure -- kept in sync here so a LATER full
// render() (triggered by some other action, e.g. submitting the form
// inside) still opens/closes each panel correctly.
//
// The toggle itself is a pure, local DOM mutation -- it deliberately never
// calls the page's rerender/render(). Every one of this app's render()
// functions starts by swapping the whole container to a loading
// placeholder and re-fetching all of that page's data from Supabase; if
// the accordion toggle went through that same path, opening a panel would
// flash to "טוען..." and hit the network every time, which reads to a
// user as the page reloading even though the URL never changes. A plain
// class/hidden toggle is instant and needs neither.
export function wireAccordions(root, { state }) {
  root.querySelectorAll('[data-accordion-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.accordionToggle;
      const card = root.querySelector(`[data-accordion-id="${id}"]`);
      const body = card && card.querySelector('.admin-accordion-body');
      if (!card || !body) return;
      const willOpen = !state.has(id);
      if (willOpen) state.add(id);
      else state.delete(id);
      card.classList.toggle('is-open', willOpen);
      body.hidden = !willOpen;
      btn.setAttribute('aria-expanded', String(willOpen));
    });
  });
}
