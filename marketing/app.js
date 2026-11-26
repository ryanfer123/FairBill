(() => {
  const byId = id => document.getElementById(id);
  const add = byId('addOrder'), reset = byId('resetExample');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pace = 'cubic-bezier(.2,.68,.22,1)';
  const transient = new WeakMap();
  function pulse(element, frames, duration) {
    transient.get(element)?.cancel();
    if (reduced.matches || !element.animate) return;
    transient.set(element, element.animate(frames, {duration, easing: pace}));
  }
  if (!reduced.matches && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        observer.unobserve(entry.target);
        pulse(entry.target, [{opacity:.72,transform:'translateY(14px)'}, {opacity:1,transform:'none'}], 440);
      }
    }, {threshold:.2});
    document.querySelectorAll('[data-reveal]').forEach(element => observer.observe(element));
  }
  reduced.addEventListener?.('change', event => {
    if (event.matches) document.getAnimations?.().forEach(animation => animation.cancel());
  });
  function update(added, moveFocus) {
    byId('revision').textContent = added ? 'Revision 2' : 'Revision 1';
    byId('conditional').textContent = added ? '₹12,800' : '₹11,900';
    byId('duplicateIcon').textContent = added ? '✓' : '?';
    byId('duplicateIcon').classList.toggle('resolved', added);
    byId('duplicateFinding').classList.toggle('resolved-row', added);
    byId('duplicateSource').textContent = added ? 'Second lab order explains the repeated charge' : 'Invoice · page 1, lines 4–5';
    byId('duplicateStatus').textContent = added ? 'Withdrawn' : '₹900 question';
    byId('duplicateStatus').classList.toggle('resolved', added);
    byId('auditNote').textContent = added
      ? 'The new order explains the second charge. The separate ₹500 quantity question stays open.'
      : 'Conditional total assumes billing accepts both questions. It is not the amount you owe.';
    byId('announcement').textContent = added
      ? 'Revision 2. Duplicate question withdrawn. The quantity question remains. Conditional total: 12,800 rupees.'
      : 'Example reset to revision 1.';
    add.hidden = added;
    reset.hidden = !added;
    if (moveFocus) (added ? reset : add).focus({preventScroll: true});
    pulse(byId('conditional'), [{opacity:.68,transform:'translateY(6px)'},{opacity:1,transform:'none'}], 240);
    pulse(byId('duplicateIcon'), [{transform:'scale(.82)'},{transform:'scale(1)'}], 220);
  }
  add.addEventListener('click', () => update(true, true));
  reset.addEventListener('click', () => update(false, true));
})();
