function renderQuestionMedia(q) {
  if (!q.mediaUrl || !q.mediaType) return '';

  // helper: атрибуты в html
  function mediaAttrs() {
    return (
      ' data-media-url="' + escapeHtml(q.mediaUrl) + '"' +
      ' data-media-type="' + escapeHtml(q.mediaType) + '"'
    );
  }

  if (q.mediaType === 'image') {
    return (
      '<div class="question-media">' +
        '<button type="button" class="qm-fs-btn" aria-label="Open fullscreen"' + mediaAttrs() +
          ' onclick="qmOpenFromEl(this)">⛶</button>' +
        '<img class="qm-preview qm-zoom"' + mediaAttrs() +
          ' onclick="qmOpenFromEl(this)"' +
          ' src="' + escapeHtml(q.mediaUrl) + '"' +
          ' alt="Question media"' +
          ' style="max-height:250px;max-width:100%;margin:16px auto;display:block;border-radius:8px;cursor:zoom-in;">' +
      '</div>'
    );
  }

  if (q.mediaType === 'audio') {
    return (
      '<div class="question-media">' +
        '<audio controls style="width:100%;margin:16px 0;">' +
          '<source src="' + escapeHtml(q.mediaUrl) + '">' +
          'Your browser does not support audio.' +
        '</audio>' +
      '</div>'
    );
  }

  if (q.mediaType === 'video') {
    return (
      '<div class="question-media">' +
        '<button type="button" class="qm-fs-btn" aria-label="Open fullscreen"' + mediaAttrs() +
          ' onclick="qmOpenFromEl(this)">⛶</button>' +
        '<video class="qm-preview"' + mediaAttrs() +
          ' onclick="qmOpenFromEl(this)"' +
          ' controls' +
          ' style="max-height:250px;max-width:100%;margin:16px auto;display:block;border-radius:8px;cursor:pointer;">' +
          '<source src="' + escapeHtml(q.mediaUrl) + '">' +
          'Your browser does not support video.' +
        '</video>' +
      '</div>'
    );
  }

  return '';
}

/**
 * Fullscreen overlay (SCORM-friendly).
 * Создаём один оверлей на весь документ и переиспользуем.
 */
(function qmInitFullscreenOverlay() {
  if (window.qmOpenFromEl) return; // уже инициализировано

  function ensureOverlay() {
    let overlay = document.getElementById('qm-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'qm-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.85)';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '99999';
    overlay.style.padding = '24px';

    overlay.innerHTML =
      '<div class="qm-overlay-content" style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;">' +
        '<button type="button" id="qm-close" aria-label="Close" ' +
          'style="position:absolute;top:12px;right:12px;font-size:22px;line-height:1;' +
          'padding:10px 12px;border-radius:10px;border:0;cursor:pointer;">✕</button>' +
        '<div id="qm-stage" style="max-width:95vw;max-height:90vh;width:100%;height:100%;display:flex;align-items:center;justify-content:center;"></div>' +
      '</div>';

    document.body.appendChild(overlay);

    // close by clicking background
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) qmClose();
    });

    // close button
    overlay.querySelector('#qm-close').addEventListener('click', qmClose);

    // Esc
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') qmClose();
    });

    return overlay;
  }

  function qmOpen(url, type) {
    const overlay = ensureOverlay();
    const stage = overlay.querySelector('#qm-stage');

    // очистим старое (и остановим видео)
    stage.innerHTML = '';

    if (type === 'image') {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Fullscreen media';
      img.style.maxWidth = '95vw';
      img.style.maxHeight = '90vh';
      img.style.objectFit = 'contain';
      img.style.borderRadius = '10px';
      stage.appendChild(img);
    } else if (type === 'video') {
      const video = document.createElement('video');
      video.controls = true;
      video.style.maxWidth = '95vw';
      video.style.maxHeight = '90vh';
      video.style.borderRadius = '10px';

      const source = document.createElement('source');
      source.src = url;
      video.appendChild(source);

      stage.appendChild(video);
      // автоплей часто блокируется LMS/браузером — не настаиваем
    } else {
      // на всякий: ничего
      return;
    }

    overlay.style.display = 'flex';
  }

  function qmClose() {
    const overlay = document.getElementById('qm-overlay');
    if (!overlay) return;
    const stage = overlay.querySelector('#qm-stage');

    // пауза видео, если оно есть
    const vid = stage && stage.querySelector && stage.querySelector('video');
    if (vid && vid.pause) vid.pause();

    if (stage) stage.innerHTML = '';
    overlay.style.display = 'none';
  }

  // открыть по атрибутам элемента (кнопка/картинка/видео)
  window.qmOpenFromEl = function (el) {
    const url = el.getAttribute('data-media-url');
    const type = el.getAttribute('data-media-type');
    if (!url || !type) return;
    qmOpen(url, type);
  };

  window.qmClose = qmClose;
})();
