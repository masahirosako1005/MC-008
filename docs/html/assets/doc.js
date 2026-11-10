/* まちクエ 要件定義書・設計書（HTML 版）の共通スクリプト：目次の自動生成・現在地の強調・パスのコピー。 */
(function () {
  'use strict';

  /** 章（section.sec > h2）から左の目次を作る。 */
  function buildToc() {
    var toc = document.querySelector('.toc');
    if (!toc) return [];
    var links = [];
    var heads = document.querySelectorAll('section.sec > h2');
    heads.forEach(function (h, i) {
      var sec = h.parentElement;
      if (!sec.id) sec.id = 'sec' + (i + 1);
      var a = document.createElement('a');
      a.href = '#' + sec.id;
      a.textContent = (i + 1) + '. ' + h.textContent;
      toc.appendChild(a);
      links.push({ a: a, sec: sec });
    });
    return links;
  }

  /** スクロール位置に合わせて、いま読んでいる章を目次で強調する。 */
  function watchScroll(links) {
    if (!links.length) return;
    function update() {
      var current = links[0];
      links.forEach(function (l) {
        if (l.sec.getBoundingClientRect().top < 120) current = l;
      });
      links.forEach(function (l) { l.a.classList.toggle('on', l === current); });
    }
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /** 文字列をクリップボードへ入れる（file:// でも動くように古い方法も試す）。 */
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  /** 「コピー」ボタン（data-copy）を使えるようにする。 */
  function wireCopyButtons() {
    document.querySelectorAll('button[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var label = btn.textContent;
        copyText(btn.getAttribute('data-copy')).then(function () {
          btn.textContent = 'コピーしました';
        }, function () {
          btn.textContent = 'コピーできません';
        }).then(function () {
          setTimeout(function () { btn.textContent = label; }, 1400);
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    watchScroll(buildToc());
    wireCopyButtons();
  });
})();
