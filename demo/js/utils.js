(function (global) {
  'use strict';

  var CFG = global.APP_CONFIG || {};

  function tr(key, vars) { return global.I18n ? global.I18n.t(key, vars) : key; }
  function currentLocale() { return global.I18n ? global.I18n.locale : 'ja-JP'; }

  function basePath() {
    if (CFG.siteBaseUrl) return String(CFG.siteBaseUrl).replace(/\/?$/, '/');
    var href = location.href.split(/[?#]/)[0];
    return href.replace(/\/[^/]*$/, '/');
  }

  function uploadUrl(pid) {
    return basePath() + 'upload.html?pid=' + encodeURIComponent(pid);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function dateKey(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function dateLabel(key) {
    var d = new Date(key + 'T12:00:00');
    if (isNaN(d.getTime())) return key;
    var weeks = tr('time.weekdays');
    var week = Array.isArray(weeks) ? weeks[d.getDay()] : '';
    return tr('time.dateLabel', {
      m: d.getMonth() + 1, d: d.getDate(),
      month: d.getMonth() + 1, day: d.getDate(), week: week
    });
  }

  function timeLabel(iso) {
    if (!iso) return tr('time.noTime');
    var d = new Date(iso);
    if (isNaN(d.getTime())) return tr('time.noTime');
    return d.toLocaleTimeString(currentLocale(), { hour: '2-digit', minute: '2-digit' });
  }

  function dateTimeLabel(iso) {
    if (!iso) return tr('time.noTaken');
    var d = new Date(iso);
    if (isNaN(d.getTime())) return tr('time.noTaken');
    return d.toLocaleString(currentLocale(), {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  }

  function relativeTime(iso) {
    if (!iso) return '';
    var diff = Date.now() - new Date(iso).getTime();
    if (isNaN(diff)) return '';
    if (diff < 60000) return tr('time.justNow');
    if (diff < 3600000) return tr('time.minutesAgo', { n: Math.floor(diff / 60000) });
    if (diff < 86400000) return tr('time.hoursAgo', { n: Math.floor(diff / 3600000) });
    if (diff < 604800000) return tr('time.daysAgo', { n: Math.floor(diff / 86400000) });
    return dateKey(iso);
  }

  function parseExifDate(value) {
    if (!value) return null;
    if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
    var text = String(value).trim();
    var normalized = text.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
    var d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(new Error(tr('err.imageRead'))); };
      reader.readAsDataURL(blob);
    });
  }

  function compressImage(file, maxEdge, quality) {
    return new Promise(function (resolve, reject) {
      var objectUrl = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var scale = Math.min(1, (maxEdge || 1600) / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cw, ch);
          ctx.drawImage(img, 0, 0, cw, ch);
          URL.revokeObjectURL(objectUrl);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error(tr('err.imageCompress')));
          }, 'image/jpeg', quality || 0.78);
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error(tr('err.imageInvalid')));
      };
      img.src = objectUrl;
    });
  }

  async function readExif(file) {
    var result = { takenAt: null, latitude: null, longitude: null, camera: null };
    if (!global.exifr) return result;
    try {
      var data = await global.exifr.parse(file, {
        tiff: true, exif: true, gps: true, translateValues: true
      });
      if (!data) return result;
      result.takenAt = parseExifDate(data.DateTimeOriginal || data.CreateDate || data.ModifyDate);
      if (typeof data.latitude === 'number' && isFinite(data.latitude)) result.latitude = data.latitude;
      if (typeof data.longitude === 'number' && isFinite(data.longitude)) result.longitude = data.longitude;
      result.camera = [data.Make, data.Model].filter(Boolean).join(' ').trim() || null;
    } catch (err) {
      console.warn('EXIF read failed (upload continues):', err);
    }
    return result;
  }

  async function reverseGeocode(lat, lon) {
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 4500) : null;
    try {
      var options = controller ? { signal: controller.signal } : {};
      var response = await fetch(
        'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' +
        encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) +
        '&localityLanguage=' + (global.I18n ? global.I18n.lang : 'ja'),
        options
      );
      if (!response.ok) return null;
      var data = await response.json();
      var parts = [data.principalSubdivision, data.city, data.locality].filter(Boolean);
      parts = parts.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
      return parts.join(' · ') || data.countryName || null;
    } catch (err) {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function downloadDataUrl(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function toast(message, type) {
    var el = document.createElement('div');
    el.className = 'toast ' + (type === 'error' ? 'toast-error' : 'toast-ok');
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('toast-in'); });
    setTimeout(function () {
      el.classList.remove('toast-in');
      setTimeout(function () { el.remove(); }, 250);
    }, 3000);
  }

  global.Utils = {
    basePath: basePath,
    uploadUrl: uploadUrl,
    escapeHtml: escapeHtml,
    uid: uid,
    dateKey: dateKey,
    dateLabel: dateLabel,
    timeLabel: timeLabel,
    dateTimeLabel: dateTimeLabel,
    relativeTime: relativeTime,
    blobToDataUrl: blobToDataUrl,
    compressImage: compressImage,
    readExif: readExif,
    reverseGeocode: reverseGeocode,
    downloadDataUrl: downloadDataUrl,
    toast: toast
  };
})(window);
