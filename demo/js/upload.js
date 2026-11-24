(function () {
  'use strict';

  var U = window.Utils;
  var CFG = window.APP_CONFIG;
  var $ = function (id) { return document.getElementById(id); };
  var t = function (key, vars) { return window.I18n.t(key, vars); };
  var params = new URLSearchParams(location.search);

  var state = {
    pid: (params.get('pid') || '').trim().toUpperCase(),
    day: params.get('day') || '',
    blob: null,
    meta: null,
    locationName: '',
    fileName: '',
    previewUrl: null
  };

  function show(section) {
    ['uploadIntro', 'previewArea', 'successView', 'errorView'].forEach(function (id) {
      $(id).hidden = id !== section;
    });
  }

  function locationSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  }
  function clockSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
  }

  async function loadSubject() {
    if (!/^P\d+$/.test(state.pid)) {
      show('errorView');
      return;
    }
    try {
      var subjects = await window.Store.listSubjects();
      var subject = subjects.find(function (s) { return s.id === state.pid; });
      $('subjectBar').innerHTML =
        '<div class="subject-avatar">' + U.escapeHtml(state.pid.slice(-3)) + '</div>' +
        '<div class="subject-bar-text"><b>' +
          U.escapeHtml(subject ? subject.name : t('upload.subjectUnknown', { pid: state.pid })) + '</b>' +
        '<span>' + U.escapeHtml(subject
          ? (subject.note || t('upload.registered', { pid: state.pid }))
          : t('upload.unregistered')) + '</span></div>' +
        '<span class="check">' + (subject ? t('upload.identified') : t('upload.unidentified')) + '</span>';
      if (state.day && !subject) $('noteInput').value = t('common.dayN', { n: state.day });
    } catch (err) {
      U.toast(err.message || t('upload.toast.readFail'), 'error');
    }
  }

  async function handleFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { U.toast(t('upload.toast.selectImage'), 'error'); return; }

    U.toast(t('upload.toast.reading'));
    try {
      var meta = await U.readExif(file);
      var isLocal = window.Store.mode === 'local';
      var blob = await U.compressImage(
        file,
        isLocal ? 1280 : CFG.maxEdge,
        isLocal ? 0.68 : CFG.jpegQuality
      );
      var locationName = '';
      if (meta.latitude != null && meta.longitude != null) {
        locationName = await U.reverseGeocode(meta.latitude, meta.longitude) || '';
      }

      state.blob = blob;
      state.meta = meta;
      state.locationName = locationName;
      state.fileName = file.name || '';
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(blob);
      $('previewImg').src = state.previewUrl;
      if (state.day && !$('noteInput').value) $('noteInput').value = t('common.dayN', { n: state.day });
      renderChips();
      show('previewArea');
    } catch (err) {
      U.toast(err.message || t('upload.toast.processFail'), 'error');
    }
  }

  function renderChips() {
    var meta = state.meta || {};
    var chips = [];

    if (meta.takenAt) {
      chips.push('<span class="meta-chip">' + clockSvg() + U.escapeHtml(t('upload.chipTaken', {
        time: U.dateTimeLabel(meta.takenAt)
      })) + '</span>');
    } else {
      chips.push('<span class="meta-chip warn">' + clockSvg() +
        U.escapeHtml(t('upload.chipNoTaken')) + '</span>');
    }

    if (state.locationName) {
      chips.push('<span class="meta-chip cyan">' + locationSvg() +
        U.escapeHtml(state.locationName) + '</span>');
    } else if (meta.latitude != null && meta.longitude != null) {
      chips.push('<span class="meta-chip cyan">' + locationSvg() +
        meta.latitude.toFixed(4) + ', ' + meta.longitude.toFixed(4) + '</span>');
    } else {
      chips.push('<span class="meta-chip warn">' + locationSvg() +
        U.escapeHtml(t('upload.chipNoLocation')) + '</span>');
    }

    chips.push('<span class="meta-chip">' + U.escapeHtml(t('upload.compressed', {
      size: Math.round(state.blob.size / 1024)
    })) + '</span>');
    $('metaChips').innerHTML = chips.join('');
  }

  function reset() {
    state.blob = null;
    state.meta = null;
    state.locationName = '';
    state.fileName = '';
    if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = null;
    $('previewImg').removeAttribute('src');
    $('noteInput').value = '';
    $('fileCamera').value = '';
    $('fileGallery').value = '';
    show('uploadIntro');
  }

  async function submit() {
    if (!state.blob) return;
    var btn = $('btnSubmit');
    btn.disabled = true;
    btn.textContent = t('upload.submitting');
    try {
      await window.Store.addUpload({
        subjectId: state.pid,
        blob: state.blob,
        takenAt: state.meta.takenAt,
        latitude: state.meta.latitude,
        longitude: state.meta.longitude,
        locationName: state.locationName,
        camera: state.meta.camera,
        note: $('noteInput').value.trim(),
        fileName: state.fileName
      });
      var key = U.dateKey(state.meta.takenAt || new Date().toISOString());
      $('successText').textContent = t('upload.successText', { pid: state.pid, date: key });
      show('successView');
    } catch (err) {
      U.toast(err.message || t('upload.toast.uploadFail'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = t('upload.submit');
    }
  }

  function bindEvents() {
    $('btnCamera').addEventListener('click', function () { $('fileCamera').click(); });
    $('btnGallery').addEventListener('click', function () { $('fileGallery').click(); });
    $('fileCamera').addEventListener('change', function (e) { handleFile(e.target.files[0]); });
    $('fileGallery').addEventListener('change', function (e) { handleFile(e.target.files[0]); });
    $('btnReset').addEventListener('click', reset);
    $('btnSubmit').addEventListener('click', submit);
    $('btnAgain').addEventListener('click', reset);

    $('btnPid').addEventListener('click', function () {
      var value = $('pidInput').value.trim().toUpperCase();
      if (!/^P\d+$/.test(value)) { U.toast(t('upload.toast.invalidPid'), 'error'); return; }
      state.pid = value;
      history.replaceState(null, '', U.basePath() + 'upload.html?pid=' + encodeURIComponent(value));
      show('uploadIntro');
      loadSubject();
    });
    $('pidInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('btnPid').click(); });
  }

  async function init() {
    window.Store.init();
    bindEvents();
    document.addEventListener('i18n:change', function () {
      if (state.blob) renderChips();
      if (!$('btnSubmit').disabled) $('btnSubmit').textContent = t('upload.submit');
      if (!$('successView').hidden && state.meta) {
        $('successText').textContent = t('upload.successText', {
          pid: state.pid,
          date: U.dateKey(state.meta.takenAt || new Date().toISOString())
        });
      }
      loadSubject();
    });
    if (!state.pid) {
      show('errorView');
      return;
    }
    await loadSubject();
  }

  init();
})();
