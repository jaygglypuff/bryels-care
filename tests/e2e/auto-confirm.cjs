// ADR-083: confirmations are on the page ("Yes, continue" / "Back"), not browser pop-ups. The e2e
// scripts used to accept window.confirm; this init script presses "Yes, continue" the same way.
module.exports = function autoConfirm() {
  const click = () => {
    for (const d of document.querySelectorAll('[role="alertdialog"]')) {
      const yes = [...d.querySelectorAll('button')].find((b) => /^Yes, continue$/.test(b.textContent.trim()));
      if (yes && !yes.dataset.autoConfirmed) { yes.dataset.autoConfirmed = '1'; yes.click(); }
    }
  };
  new MutationObserver(click).observe(document, { childList: true, subtree: true });
};
