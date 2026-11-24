(function () {
  'use strict';

  var U = window.Utils;
  var QR = window.QRCode;
  var $ = function (id) { return document.getElementById(id); };
  var t = function (key, vars) { return window.I18n.t(key, vars); };

  var state = {
    subjects: [],
    uploadMap: {},
    currentPid: null,
    qrPid: null,
    activePhoto: null,
    confirmAction: null,
    confirmKey: '',
    confirmVars: null
  };

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  function switchView(name) {
    ['subjects', 'subject', 'help'].forEach(function (v) { $('view-' + v).hidden = v !== name; });
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === name ||
        (name === 'subject' && btn.dataset.view === 'subjects'));
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function nextPreviewId() {
    var max = 0;
    state.subjects.forEach(function (s) {
      var m = /^P(\d+)$/.exec(s.id || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'P' + String(max + 1).padStart(3, '0');
  }

  function renderMiniQr(container, url) {
    if (!QR) { container.textContent = 'QR'; return; }
    var canvas = document.createElement('canvas');
    container.appendChild(canvas);
    QR.toCanvas(canvas, url, {
      width: 120, margin: 0,
      color: { dark: '#2b3050', light: '#ffffff' },
      errorCorrectionLevel: 'M'
    }).catch(function () { container.textContent = 'QR'; });
  }

  async function loadSubjects() {
    try {
      state.subjects = await window.Store.listSubjects();
      state.uploadMap = {};
      await Promise.all(state.subjects.map(async function (s) {
        state.uploadMap[s.id] = await window.Store.listUploads(s.id);
      }));
      renderStats();
      renderSubjects();
      $('newId').value = nextPreviewId();
    } catch (err) {
      U.toast(err.message || t('admin.toast.loadFail'), 'error');
    }
  }

  function renderStats() {
    var all = Object.keys(state.uploadMap).reduce(function (sum, pid) {
      return sum.concat(state.uploadMap[pid]);
    }, []);
    var today = U.dateKey(new Date().toISOString());
    $('statSubjects').textContent = state.subjects.length;
    $('statPhotos').textContent = all.length;
    $('statToday').textContent = all.filter(function (u) { return U.dateKey(u.createdAt) === today; }).length;
    $('statMode').textContent = t(window.Store.mode === 'supabase'
      ? 'admin.modeShortCloud' : 'admin.modeShortLocal');
  }

  function renderSubjects() {
    var query = ($('searchInput').value || '').trim().toLowerCase();
    var list = state.subjects.filter(function (s) {
      return !query || s.id.toLowerCase().indexOf(query) >= 0 ||
        (s.name || '').toLowerCase().indexOf(query) >= 0;
    });
    $('subjectCount').textContent = t('admin.count', { n: list.length });
    var grid = $('subjectGrid');
    grid.innerHTML = '';

    if (!list.length) {
      var noSubjects = state.subjects.length === 0;
      grid.innerHTML = '<div class="empty"><div class="empty-icon">▦</div><h3>' +
        U.escapeHtml(t(noSubjects ? 'admin.emptyNoSubjects' : 'admin.emptyNoMatch')) +
        '</h3><p>' + U.escapeHtml(t(noSubjects ? 'admin.emptyCreateHint' : 'admin.emptyTryOther')) +
        '</p></div>';
      return;
    }

    list.forEach(function (subject) {
      var uploads = state.uploadMap[subject.id] || [];
      var latest = uploads.length ? U.relativeTime(uploads[0].createdAt) : t('admin.noUploads');
      var card = document.createElement('article');
      card.className = 'subject-card';
      card.dataset.pid = subject.id;
      card.innerHTML =
        '<div class="subject-card-top">' +
          '<div class="subject-avatar">' + U.escapeHtml(subject.id.slice(-3)) + '</div>' +
          '<div class="subject-info"><h3>' + U.escapeHtml(subject.name) + '</h3><p>' +
            U.escapeHtml(subject.note || t('common.noNote')) + '</p></div>' +
          '<div class="qr-mini" data-qr-for="' + U.escapeHtml(subject.id) + '"></div>' +
        '</div>' +
        '<div class="subject-card-foot">' +
          '<div class="subject-stat">' + U.escapeHtml(t('common.photosShort', { n: uploads.length })) +
            ' · ' + U.escapeHtml(latest) + '</div>' +
          '<div class="icon-actions">' +
            '<button class="icon-btn" data-act="qr" data-pid="' + U.escapeHtml(subject.id) + '" title="' +
              U.escapeHtml(t('admin.detailQR')) + '">▦</button>' +
            '<button class="icon-btn" data-act="open" data-pid="' + U.escapeHtml(subject.id) + '" title="' +
              U.escapeHtml(t('admin.detailOpen')) + '">↗</button>' +
            '<button class="icon-btn danger" data-act="delete" data-pid="' + U.escapeHtml(subject.id) + '" title="' +
              U.escapeHtml(t('common.confirmDelete')) + '">×</button>' +
          '</div>' +
        '</div>';
      grid.appendChild(card);
      renderMiniQr(card.querySelector('[data-qr-for]'), U.uploadUrl(subject.id));
    });
  }

  async function openSubject(pid) {
    state.currentPid = pid;
    switchView('subject');
    var subject = state.subjects.find(function (s) { return s.id === pid; });
    if (!subject) return;
    $('detailId').textContent = t('admin.detailEyebrow', { id: subject.id });
    $('detailName').textContent = subject.name;
    $('detailNote').textContent = subject.note || t('common.noNote');
    try {
      var uploads = await window.Store.listUploads(pid);
      state.uploadMap[pid] = uploads;
      renderDetailMeta(subject, uploads);
      renderDateGroups(uploads);
    } catch (err) {
      U.toast(err.message || t('admin.toast.photosFail'), 'error');
    }
  }

  function renderDetailMeta(subject, uploads) {
    var latest = uploads.length ? U.dateTimeLabel(uploads[0].createdAt) : t('common.none');
    $('detailMeta').innerHTML =
      '<div class="detail-chip">' + U.escapeHtml(t('admin.detailId')) +
        ' <b class="mono">' + U.escapeHtml(subject.id) + '</b></div>' +
      '<div class="detail-chip">' + U.escapeHtml(t('admin.detailCreated')) +
        ' <b>' + U.escapeHtml(U.dateLabel(U.dateKey(subject.createdAt))) + '</b></div>' +
      '<div class="detail-chip">' + U.escapeHtml(t('admin.detailPhotos')) +
        ' <b>' + uploads.length + '</b></div>' +
      '<div class="detail-chip">' + U.escapeHtml(t('admin.detailLatest')) +
        ' <b>' + U.escapeHtml(latest) + '</b></div>';
  }

  function renderDateGroups(uploads) {
    var container = $('dateGroups');
    container.innerHTML = '';
    if (!uploads.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">▧</div><h3>' +
        U.escapeHtml(t('admin.emptyNoPhotosTitle')) + '</h3><p>' +
        U.escapeHtml(t('admin.emptyNoPhotosBody')) + '</p></div>';
      return;
    }

    var groups = {};
    uploads.forEach(function (upload) {
      var key = U.dateKey(upload.takenAt || upload.createdAt);
      if (!groups[key]) groups[key] = [];
      groups[key].push(upload);
    });

    Object.keys(groups).sort().reverse().forEach(function (key) {
      var section = document.createElement('section');
      section.className = 'date-group';
      var head = document.createElement('div');
      head.className = 'date-group-head';
      head.innerHTML = '<h2>' + U.escapeHtml(U.dateLabel(key)) + '</h2><span>' +
        U.escapeHtml(t('common.photosShort', { n: groups[key].length })) + '</span>';
      section.appendChild(head);

      var grid = document.createElement('div');
      grid.className = 'photo-grid';
      groups[key].forEach(function (upload) {
        var location = upload.locationName ||
          (upload.latitude != null && upload.longitude != null
            ? upload.latitude.toFixed(4) + ', ' + upload.longitude.toFixed(4) : '');
        var card = document.createElement('article');
        card.className = 'photo-card';
        card.dataset.photoId = upload.id;
        card.innerHTML =
          '<img class="photo-thumb" src="' + U.escapeHtml(upload.imageUrl) + '" alt="' +
            U.escapeHtml(t('upload.previewAlt')) + '" loading="lazy">' +
          '<div class="photo-card-body">' +
            '<div class="photo-time"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>' +
              U.escapeHtml(U.timeLabel(upload.takenAt || upload.createdAt)) + '</div>' +
            '<div class="photo-loc ' + (location ? '' : 'tag-none') + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>' +
              U.escapeHtml(location || t('upload.chipNoLocation')) + '</div>' +
          '</div>';
        grid.appendChild(card);
      });
      section.appendChild(grid);
      container.appendChild(section);
    });
  }

  function openPhoto(id) {
    var uploads = state.uploadMap[state.currentPid] || [];
    var photo = uploads.find(function (u) { return u.id === id; });
    if (!photo) return;
    state.activePhoto = photo;
    $('photoFull').src = photo.imageUrl;
    var none = t('common.notRecorded');
    var coord = photo.latitude != null && photo.longitude != null
      ? photo.latitude.toFixed(5) + ', ' + photo.longitude.toFixed(5) : none;
    var rows = [
      [t('admin.metaTaken'), U.dateTimeLabel(photo.takenAt)],
      [t('admin.metaUploaded'), U.dateTimeLabel(photo.createdAt)],
      [t('admin.metaLocation'), photo.locationName || none],
      [t('admin.metaGps'), coord],
      [t('admin.metaCamera'), photo.camera || none],
      [t('admin.metaFile'), photo.fileName || none]
    ];
    $('photoMeta').innerHTML = rows.map(function (r) {
      return '<div><dt>' + U.escapeHtml(r[0]) + '</dt><dd>' + U.escapeHtml(r[1]) + '</dd></div>';
    }).join('');
    $('photoNote').textContent = photo.note ? t('common.notePrefix') + photo.note : t('common.noNote');
    openModal('modalPhoto');
  }

  async function openQR(pid) {
    var subject = state.subjects.find(function (s) { return s.id === pid; });
    if (!subject) return;
    state.qrPid = pid;
    var url = U.uploadUrl(pid);
    $('qrTitle').textContent = t('admin.qrTitle', { id: subject.id });
    $('qrSubject').textContent = subject.id + ' · ' + subject.name;
    $('qrUrl').value = url;
    openModal('modalQR');
    var canvas = $('qrCanvas');
    if (!QR) { U.toast(t('admin.toast.qrNotLoaded'), 'error'); return; }
    try {
      await QR.toCanvas(canvas, url, {
        width: 560, margin: 1,
        color: { dark: '#1c2440', light: '#ffffff' },
        errorCorrectionLevel: 'M'
      });
    } catch (err) {
      U.toast(t('admin.toast.qrFail'), 'error');
    }
  }

  function confirmDelete(key, vars, action) {
    state.confirmKey = key;
    state.confirmVars = vars;
    state.confirmAction = action;
    $('confirmText').textContent = t(key, vars);
    openModal('modalConfirm');
  }

  function bindEvents() {
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () { switchView(btn.dataset.view); });
    });

    document.querySelectorAll('[data-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closeModal(btn.dataset.close); });
    });

    $('btnNewSubject').addEventListener('click', function () {
      $('newId').value = nextPreviewId();
      $('newName').value = '';
      $('newNote').value = '';
      openModal('modalNew');
      setTimeout(function () { $('newName').focus(); }, 50);
    });

    async function createSubject() {
      var name = $('newName').value.trim();
      if (!name) { U.toast(t('admin.toast.nameRequired'), 'error'); $('newName').focus(); return; }
      try {
        var subject = await window.Store.createSubject(name, $('newNote').value);
        closeModal('modalNew');
        U.toast(t('admin.toast.created', { id: subject.id }));
        await loadSubjects();
        openQR(subject.id);
      } catch (err) {
        U.toast(err.message || t('admin.toast.createFail'), 'error');
      }
    }
    $('btnCreate').addEventListener('click', createSubject);
    $('newName').addEventListener('keydown', function (e) { if (e.key === 'Enter') createSubject(); });

    $('searchInput').addEventListener('input', renderSubjects);

    $('subjectGrid').addEventListener('click', function (e) {
      var button = e.target.closest('[data-act]');
      var pid = button ? button.dataset.pid : e.target.closest('[data-pid]').dataset.pid;
      if (!pid) return;
      if (button && button.dataset.act === 'qr') openQR(pid);
      else if (button && button.dataset.act === 'open') window.open(U.uploadUrl(pid), '_blank');
      else if (button && button.dataset.act === 'delete') {
        confirmDelete('admin.confirmDeleteSubject', { id: pid }, async function () {
          try {
            await window.Store.deleteSubject(pid);
            U.toast(t('admin.toast.deleted', { id: pid }));
            closeModal('modalConfirm');
            await loadSubjects();
          } catch (err) { U.toast(err.message || t('admin.toast.deleteFail'), 'error'); }
        });
      } else openSubject(pid);
    });

    $('btnBack').addEventListener('click', function () { switchView('subjects'); });
    $('btnDetailQR').addEventListener('click', function () { openQR(state.currentPid); });
    $('btnDetailOpen').addEventListener('click', function () {
      window.open(U.uploadUrl(state.currentPid), '_blank');
    });

    $('dateGroups').addEventListener('click', function (e) {
      var card = e.target.closest('[data-photo-id]');
      if (card) openPhoto(card.dataset.photoId);
    });

    $('btnDeletePhoto').addEventListener('click', function () {
      if (!state.activePhoto) return;
      var pid = state.currentPid;
      var id = state.activePhoto.id;
      confirmDelete('admin.confirmDeletePhoto', null, async function () {
        try {
          await window.Store.deleteUpload(pid, id);
          closeModal('modalConfirm');
          closeModal('modalPhoto');
          U.toast(t('admin.toast.photoDeleted'));
          var uploads = await window.Store.listUploads(pid);
          state.uploadMap[pid] = uploads;
          renderDetailMeta(state.subjects.find(function (s) { return s.id === pid; }), uploads);
          renderDateGroups(uploads);
          renderStats();
        } catch (err) { U.toast(err.message || t('admin.toast.deleteFail'), 'error'); }
      });
    });

    $('btnConfirmOk').addEventListener('click', function () {
      if (state.confirmAction) state.confirmAction();
    });

    $('btnCopyUrl').addEventListener('click', async function () {
      var text = $('qrUrl').value;
      try {
        await navigator.clipboard.writeText(text);
        U.toast(t('admin.toast.linkCopied'));
      } catch (err) {
        $('qrUrl').select();
        document.execCommand('copy');
        U.toast(t('admin.toast.linkCopied'));
      }
    });

    $('btnDownloadQR').addEventListener('click', async function () {
      if (!QR) return;
      try {
        var dataUrl = await QR.toDataURL($('qrUrl').value, {
          width: 900, margin: 2, color: { dark: '#1c2440', light: '#ffffff' }
        });
        U.downloadDataUrl(dataUrl, (state.qrPid || 'subject') + '-qrcode.png');
      } catch (err) { U.toast(t('admin.toast.downloadFail'), 'error'); }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      ['modalNew', 'modalQR', 'modalPhoto', 'modalConfirm'].forEach(function (id) { closeModal(id); });
    });
  }

  function updateMode() {
    var mode = window.Store.mode;
    $('modeBadge').textContent = t(mode === 'supabase' ? 'admin.modeCloud' : 'admin.modeLocal');
    if (window.Store.configError) {
      $('configBanner').textContent = t('err.configMissing');
      $('configBanner').hidden = false;
    }
  }

  async function init() {
    window.Store.init();
    updateMode();
    bindEvents();
    document.addEventListener('i18n:change', function () {
      updateMode();
      renderStats();
      renderSubjects();
      $('subjectCount').textContent = t('admin.count', { n: state.subjects.length });
      if (state.currentPid && !$('view-subject').hidden) {
        var subject = state.subjects.find(function (s) { return s.id === state.currentPid; });
        var uploads = state.uploadMap[state.currentPid] || [];
        if (subject) {
          $('detailId').textContent = t('admin.detailEyebrow', { id: subject.id });
          $('detailNote').textContent = subject.note || t('common.noNote');
          renderDetailMeta(subject, uploads);
        }
        renderDateGroups(uploads);
      }
      if (!$('modalQR').hidden && state.qrPid) {
        $('qrTitle').textContent = t('admin.qrTitle', { id: state.qrPid });
      }
      if (!$('modalPhoto').hidden && state.activePhoto) openPhoto(state.activePhoto.id);
      if (!$('modalConfirm').hidden && state.confirmAction) {
        $('confirmText').textContent = t(state.confirmKey, state.confirmVars);
      }
    });
    await loadSubjects();
  }

  init();
})();
