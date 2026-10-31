// ADR-083: confirmations are on the page ("Yes, continue" / "Back"), not browser pop-ups. The e2e
// scripts used to accept window.confirm; this init script presses "Yes, continue" the same way.
module.exports = function autoConfirm() {
  const click = () => {
    for (const d of document.querySelectorAll('[role="alertdialog"]')) {
      // Also the warehouse screens' named confirmations (usability test 2026-10-30); never "Yes, 50 g"-style answers.
      const yes = [...d.querySelectorAll('button')].find((b) => /^Yes, (continue|start the count|finish|save to stock)$/.test(b.textContent.trim()));
      if (yes && !yes.dataset.autoConfirmed) { yes.dataset.autoConfirmed = '1'; yes.click(); }
    }
  };
  new MutationObserver(click).observe(document, { childList: true, subtree: true });
};
