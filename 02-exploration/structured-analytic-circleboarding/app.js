(function () {
  'use strict';

  const STORAGE_KEY = 'circleboard-state';
  const CATEGORY_KEYS = ['who', 'what', 'why', 'when', 'where', 'how'];
  const LANE_ORDER = ['who', 'what', 'why', 'when', 'where', 'how'];
  var CIRCLEBOARD_DATA_FILE = 'CircleboardData.txt';
  var INDICATORS_FILE = '/data/hypothesis_keywords.jsonl';

  function genId() {
    return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  function emptyState() {
    return {
      who: [], what: [], where: [], when: [], why: [], how: [],
      soWhatLanes: [[], [], [], [], [], []],
      trashLanes: [[], [], [], [], [], []]
    };
  }

  function ensureItemShape(item) {
    if (item && typeof item === 'object' && item.id != null && item.text != null) return item;
    if (typeof item === 'string') return { id: genId(), text: item };
    return null;
  }

  function ensureArrayOfItems(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(ensureItemShape).filter(Boolean);
  }

  function normalizeState(state) {
    if (!state) return emptyState();
    var out = emptyState();
    CATEGORY_KEYS.forEach(function (k) {
      out[k] = ensureArrayOfItems(state[k] || []);
    });
    if (state.soWhatLanes && Array.isArray(state.soWhatLanes)) {
      state.soWhatLanes.forEach(function (lane, i) {
        out.soWhatLanes[i] = i < 6 ? ensureArrayOfItems(lane || []) : (out.soWhatLanes[i] || []);
      });
    } else if (state.so_what && Array.isArray(state.so_what)) {
      out.soWhatLanes[0] = ensureArrayOfItems(state.so_what);
    }
    if (state.trashLanes && Array.isArray(state.trashLanes)) {
      state.trashLanes.forEach(function (lane, i) {
        out.trashLanes[i] = i < 6 ? ensureArrayOfItems(lane || []) : (out.trashLanes[i] || []);
      });
    }
    return out;
  }

  var HEADER_TO_KEY = {
    'Who?': 'who', 'What?': 'what', 'Where?': 'where', 'When?': 'when',
    'Why?': 'why', 'How?': 'how', 'So what?': 'so_what'
  };

  function parseMarkdownLike(text) {
    var state = { who: [], what: [], where: [], when: [], why: [], how: [], so_what: [] };
    var current = null;
    text.split(/\r?\n/).forEach(function (line) {
      var trimmed = line.trim();
      if (/^.+\?\s*$/.test(trimmed)) {
        current = HEADER_TO_KEY[trimmed] != null ? HEADER_TO_KEY[trimmed] : null;
        return;
      }
      if (current && trimmed.startsWith('- ')) {
        state[current].push(trimmed.slice(2).trim());
      }
    });
    return state;
  }

  function parseYamlLike(text) {
    var state = { who: [], what: [], where: [], when: [], why: [], how: [], so_what: [] };
    var current = null;
    text.split(/\r?\n/).forEach(function (line) {
      var keyMatch = line.match(/^([\w\s]+?)\s*:\s*$/);
      if (keyMatch) {
        var k = keyMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
        current = state.hasOwnProperty(k) ? k : null;
        return;
      }
      var bulletMatch = line.match(/^\s*-\s+(.*)$/);
      if (current && bulletMatch) {
        state[current].push(bulletMatch[1].trim());
      }
    });
    return state;
  }

  function parseIndicators(text) {
    var raw = (text || '').trim();
    if (raw.startsWith('{')) {
      try {
        var o = JSON.parse(raw);
        return {
          who: Array.isArray(o.who) ? o.who : [],
          what: Array.isArray(o.what) ? o.what : [],
          where: Array.isArray(o.where) ? o.where : [],
          when: Array.isArray(o.when) ? o.when : [],
          why: Array.isArray(o.why) ? o.why : [],
          how: Array.isArray(o.how) ? o.how : [],
          so_what: Array.isArray(o.so_what) ? o.so_what : [],
          soWhatLanes: Array.isArray(o.soWhatLanes) ? o.soWhatLanes : null
        };
      } catch (e) {
        return parseMarkdownLike(text);
      }
    }
    if (/^\w+\s*:\s*$/m.test(raw)) return parseYamlLike(text);
    return parseMarkdownLike(text);
  }

  /** Parse JSONL file: one JSON object per line. Aggregates all records into one object with who/what/when/where/why/how as string arrays. */
  function parseJsonlIndicators(text) {
    var out = { who: [], what: [], when: [], where: [], why: [], how: [] };
    if (!text || typeof text !== 'string') return out;
    var lines = text.split(/\r?\n/).filter(function (line) { return line.trim() !== ''; });
    lines.forEach(function (line) {
      try {
        var record = JSON.parse(line);
        var what = Array.isArray(record.what) ? record.what : [];
        var who = Array.isArray(record.who) ? record.who : [];
        var when = Array.isArray(record.when) ? record.when : [];
        var where = Array.isArray(record.where) ? record.where : [];
        var why = Array.isArray(record.why) ? record.why : [];
        var how = Array.isArray(record.how) ? record.how : [];
        what.forEach(function (s) { if (typeof s === 'string' && s.trim()) out.what.push(s.trim()); });
        who.forEach(function (s) { if (typeof s === 'string' && s.trim()) out.who.push(s.trim()); });
        when.forEach(function (s) { if (typeof s === 'string' && s.trim()) out.when.push(s.trim()); });
        where.forEach(function (s) { if (typeof s === 'string' && s.trim()) out.where.push(s.trim()); });
        why.forEach(function (s) { if (typeof s === 'string' && s.trim()) out.why.push(s.trim()); });
        how.forEach(function (s) { if (typeof s === 'string' && s.trim()) out.how.push(s.trim()); });
      } catch (e) { /* skip invalid line */ }
    });
    return out;
  }

  function loadFromStorage() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return normalizeState(o);
    } catch (e) {
      return null;
    }
  }

  function hasAnyItems(state) {
    var s = state || emptyState();
    for (var i = 0; i < CATEGORY_KEYS.length; i++) {
      if (s[CATEGORY_KEYS[i]] && s[CATEGORY_KEYS[i]].length) return true;
    }
    if (s.soWhatLanes) {
      for (var j = 0; j < s.soWhatLanes.length; j++) {
        if (s.soWhatLanes[j] && s.soWhatLanes[j].length) return true;
      }
    }
    if (s.trashLanes) {
      for (var t = 0; t < s.trashLanes.length; t++) {
        if (s.trashLanes[t] && s.trashLanes[t].length) return true;
      }
    }
    return false;
  }

  function saveToStorage(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function saveToServer(state, callback) {
    if (typeof callback !== 'function') callback = function () {};
    fetch('/api/save-circleboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    }).then(function (r) {
      if (r.ok) callback(null);
      else callback(new Error('Save failed'));
    }).catch(callback);
  }

  /** Merge items from hypothesis_keywords.jsonl into current state: append new items (by text) per category. soWhatLanes and trashLanes unchanged. */
  function mergeIndicatorsIntoState(currentState, parsedIndicators) {
    var state = {
      who: (currentState.who || []).slice(),
      what: (currentState.what || []).slice(),
      where: (currentState.where || []).slice(),
      when: (currentState.when || []).slice(),
      why: (currentState.why || []).slice(),
      how: (currentState.how || []).slice(),
      soWhatLanes: (currentState.soWhatLanes || [[],[],[],[],[],[]]).map(function (lane) { return (lane || []).slice(); }),
      trashLanes: (currentState.trashLanes || [[],[],[],[],[],[]]).map(function (lane) { return (lane || []).slice(); })
    };
    var existingText = function (arr) {
      return arr.map(function (o) { return (o.text || o).toString().trim(); });
    };
    CATEGORY_KEYS.forEach(function (k) {
      var existing = existingText(state[k]);
      var fromFile = Array.isArray(parsedIndicators[k]) ? parsedIndicators[k] : [];
      fromFile.forEach(function (item) {
        var text = (item && item.text != null) ? item.text : String(item);
        text = text.trim();
        if (text && existing.indexOf(text) === -1) {
          existing.push(text);
          state[k].push(ensureItemShape(text));
        }
      });
    });
    return state;
  }

  function createItemElement(id, text, opts) {
    opts = opts || {};
    var div = document.createElement('div');
    div.className = opts.className || 'category-item';
    div.setAttribute('draggable', 'true');
    div.setAttribute('data-item-id', id);
    div.setAttribute('data-text', text);
    div.setAttribute('role', 'listitem');

    var textEl = document.createElement('span');
    textEl.className = 'category-item-text';
    textEl.textContent = text;
    div.appendChild(textEl);

    if (opts.showTrash && (opts.categoryKey || opts.soWhatLaneIndex != null)) {
      if (opts.categoryKey) div.setAttribute('data-category', opts.categoryKey);
      var trashBtn = document.createElement('button');
      trashBtn.type = 'button';
      trashBtn.className = 'btn-item-trash';
      trashBtn.setAttribute('aria-label', 'Move to trash');
      trashBtn.innerHTML = '\u232B';
      trashBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (opts.soWhatLaneIndex != null) {
          moveSoWhatToTrash(id, text, opts.soWhatLaneIndex);
        } else {
          moveToTrash(id, text, opts.categoryKey);
        }
      });
      div.appendChild(trashBtn);
    }

    div.addEventListener('click', function (e) {
      if (e.target.classList.contains('btn-item-trash')) return;
      var sel = document.querySelectorAll('.category-item.is-selected, .so-what-item.is-selected');
      sel.forEach(function (el) { if (el !== div) el.classList.remove('is-selected'); });
      div.classList.toggle('is-selected');
    });

    div.addEventListener('dblclick', function (e) {
      if (e.target.classList.contains('btn-item-trash')) return;
      e.preventDefault();
      textEl.setAttribute('contenteditable', 'true');
      textEl.focus();
    });
    textEl.addEventListener('blur', function () {
      textEl.removeAttribute('contenteditable');
      var t = textEl.textContent.trim();
      div.setAttribute('data-text', t);
      if (typeof window.saveStateFromDOM === 'function') window.saveStateFromDOM();
    });

    return div;
  }

  function moveToTrash(id, text, categoryKey) {
    var state = getStateFromDOM();
    var idx = CATEGORY_KEYS.indexOf(categoryKey);
    if (idx === -1) return;
    state[categoryKey] = (state[categoryKey] || []).filter(function (o) { return o.id !== id; });
    (state.trashLanes = state.trashLanes || [[],[],[],[],[],[]])[idx] = (state.trashLanes[idx] || []).concat({ id: id, text: text });
    doSave(state);
    render(state);
  }

  function moveSoWhatToTrash(id, text, laneIndex) {
    var state = getStateFromDOM();
    state.soWhatLanes = state.soWhatLanes || [[], [], [], [], [], []];
    state.soWhatLanes[laneIndex] = (state.soWhatLanes[laneIndex] || []).filter(function (o) { return o.id !== id; });
    state.trashLanes = state.trashLanes || [[], [], [], [], [], []];
    state.trashLanes[laneIndex] = (state.trashLanes[laneIndex] || []).concat({ id: id, text: text });
    doSave(state);
    render(state);
  }

  function returnFromTrash(id, text, laneIndex) {
    var state = getStateFromDOM();
    var categoryKey = CATEGORY_KEYS[laneIndex];
    if (!categoryKey) return;
    state.trashLanes = state.trashLanes || [[], [], [], [], [], []];
    state.trashLanes[laneIndex] = (state.trashLanes[laneIndex] || []).filter(function (o) { return o.id !== id; });
    state[categoryKey] = (state[categoryKey] || []).concat({ id: id, text: text });
    doSave(state);
    render(state);
  }

  function renderCategory(categoryKey, items, stateRef) {
    var box = document.querySelector('.category-box[data-category="' + categoryKey + '"]');
    if (!box) return;
    var container = box.querySelector('.category-items');
    var countEl = box.querySelector('.category-count');
    if (!container) return;

    container.innerHTML = '';
    (items || []).forEach(function (obj) {
      var id = obj.id, text = obj.text;
      container.appendChild(createItemElement(id, text, { showTrash: true, categoryKey: categoryKey }));
    });
    if (countEl) countEl.textContent = (items || []).length;
  }

  function renderTrashLane(laneIndex, items) {
    var lane = document.querySelector('.trash-lane[data-lane="' + laneIndex + '"] .trash-lane-items');
    if (!lane) return;
    lane.innerHTML = '';
    (items || []).forEach(function (obj) {
      var div = document.createElement('div');
      div.className = 'trash-item';
      div.setAttribute('data-item-id', obj.id);
      div.setAttribute('data-text', obj.text);
      var span = document.createElement('span');
      span.className = 'trash-item-text';
      span.textContent = obj.text;
      div.appendChild(span);
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-item-return';
      btn.textContent = 'Return';
      btn.setAttribute('aria-label', 'Return to ' + (CATEGORY_KEYS[laneIndex] || 'category'));
      btn.addEventListener('click', function () {
        returnFromTrash(obj.id, obj.text, laneIndex);
      });
      div.appendChild(btn);
      lane.appendChild(div);
    });
  }

  function renderSoWhatLane(laneIndex, items) {
    var lane = document.querySelector('.so-what-lane[data-lane="' + laneIndex + '"] .so-what-lane-items');
    if (!lane) return;
    lane.innerHTML = '';
    (items || []).forEach(function (obj) {
      var div = createItemElement(obj.id, obj.text, { className: 'so-what-item', showTrash: true, soWhatLaneIndex: laneIndex });
      lane.appendChild(div);
    });
  }

  function updateSoWhatEmptyHint(state) {
    var total = 0;
    (state.soWhatLanes || []).forEach(function (lane) {
      total += (lane && lane.length) || 0;
    });
    var box = document.querySelector('.so-what-box');
    if (box) {
      if (total > 0) box.classList.add('has-items');
      else box.classList.remove('has-items');
    }
  }

  function render(state) {
    state = state || emptyState();
    CATEGORY_KEYS.forEach(function (k) {
      renderCategory(k, state[k] || []);
    });
    var lanes = state.soWhatLanes || [[], [], [], [], [], []];
    for (var i = 0; i < 6; i++) {
      renderSoWhatLane(i, lanes[i] || []);
    }
    var trashLanes = state.trashLanes || [[], [], [], [], [], []];
    for (var t = 0; t < 6; t++) {
      renderTrashLane(t, trashLanes[t] || []);
    }
    updateSoWhatEmptyHint(state);
  }

  function removeItemById(state, id) {
    var found = null;
    CATEGORY_KEYS.forEach(function (k) {
      var arr = state[k] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) {
          found = { type: 'category', key: k, index: i };
          return;
        }
      }
    });
    if (found) {
      state[found.key].splice(found.index, 1);
      return { type: 'category', key: found.key };
    }
    var lanes = state.soWhatLanes || [];
    for (var lane = 0; lane < lanes.length; lane++) {
      var laneArr = lanes[lane] || [];
      for (var j = 0; j < laneArr.length; j++) {
        if (laneArr[j].id === id) {
          state.soWhatLanes[lane].splice(j, 1);
          return { type: 'soWhat', lane: lane };
        }
      }
    }
    return null;
  }

  function getItemById(state, id) {
    var arr;
    CATEGORY_KEYS.forEach(function (k) {
      arr = state[k] || [];
      for (var i = 0; i < arr.length; i++) {
        if (arr[i].id === id) return arr[i];
      }
    });
    var lanes = state.soWhatLanes || [];
    for (var lane = 0; lane < lanes.length; lane++) {
      arr = lanes[lane] || [];
      for (var j = 0; j < arr.length; j++) {
        if (arr[j].id === id) return arr[j];
      }
    }
    return null;
  }

  function getStateFromDOM() {
    var state = emptyState();
    CATEGORY_KEYS.forEach(function (k) {
      var box = document.querySelector('.category-box[data-category="' + k + '"]');
      if (!box) return;
      var items = box.querySelectorAll('.category-item[data-item-id]');
      state[k] = Array.from(items).map(function (el) {
        return {
          id: el.getAttribute('data-item-id'),
          text: el.getAttribute('data-text') || el.textContent.trim()
        };
      });
    });
    state.soWhatLanes = [[], [], [], [], [], []];
    for (var i = 0; i < 6; i++) {
      var laneEl = document.querySelector('.so-what-lane[data-lane="' + i + '"] .so-what-lane-items');
      if (!laneEl) continue;
      var soItems = laneEl.querySelectorAll('.so-what-item[data-item-id]');
      state.soWhatLanes[i] = Array.from(soItems).map(function (el) {
        return {
          id: el.getAttribute('data-item-id'),
          text: el.getAttribute('data-text') || el.textContent.trim()
        };
      });
    }
    state.trashLanes = [[], [], [], [], [], []];
    for (var j = 0; j < 6; j++) {
      var trashLaneEl = document.querySelector('.trash-lane[data-lane="' + j + '"] .trash-lane-items');
      if (!trashLaneEl) continue;
      var trashItems = trashLaneEl.querySelectorAll('.trash-item[data-item-id]');
      state.trashLanes[j] = Array.from(trashItems).map(function (el) {
        return {
          id: el.getAttribute('data-item-id'),
          text: el.getAttribute('data-text') || el.textContent.trim()
        };
      });
    }
    return state;
  }

  window.saveStateFromDOM = function () {
    doSave(getStateFromDOM());
  };

  function setupDragAndDrop(stateRef) {
    var DRAG_PAYLOAD_KEY = 'application/circleboard-drag';

    function getPayload(e) {
      try {
        return JSON.parse(e.dataTransfer.getData(DRAG_PAYLOAD_KEY) || '{}');
      } catch (err) {
        return {};
      }
    }

    function setPayload(e, payload) {
      e.dataTransfer.setData(DRAG_PAYLOAD_KEY, JSON.stringify(payload));
    }

    function clearLaneHighlights() {
      document.querySelectorAll('.so-what-lane.lane-highlight').forEach(function (el) {
        el.classList.remove('lane-highlight');
      });
      document.querySelectorAll('.so-what-lane-items .drop-insertion').forEach(function (el) {
        el.remove();
      });
    }

    function ensureInsertionIndicator(laneItemsEl, beforeEl) {
      var existing = laneItemsEl.querySelector('.drop-insertion');
      if (existing) {
        if (beforeEl) {
          laneItemsEl.insertBefore(existing, beforeEl);
        } else {
          laneItemsEl.appendChild(existing);
        }
        return;
      }
      var line = document.createElement('div');
      line.className = 'drop-insertion';
      line.setAttribute('aria-hidden', 'true');
      if (beforeEl) {
        laneItemsEl.insertBefore(line, beforeEl);
      } else {
        laneItemsEl.appendChild(line);
      }
    }

    function soWhatAutoScroll(e) {
      var content = document.querySelector('.so-what-content');
      if (!content) return;
      var rect = content.getBoundingClientRect();
      var edge = 40;
      if (e.clientY < rect.top + edge) {
        content.scrollTop = Math.max(0, content.scrollTop - 8);
      } else if (e.clientY > rect.bottom - edge) {
        content.scrollTop += 8;
      }
    }

    document.querySelectorAll('.category-box').forEach(function (box) {
      var container = box.querySelector('.category-items');
      var category = box.getAttribute('data-category');
      if (!container) return;

      container.addEventListener('dragstart', function (e) {
        var item = e.target.closest('.category-item');
        if (!item || item.closest('.so-what-lane')) return;
        var id = item.getAttribute('data-item-id');
        var text = item.getAttribute('data-text') || item.textContent.trim();
        e.dataTransfer.effectAllowed = 'move';
        setPayload(e, { sourceType: 'category', sourceKey: category, id: id, text: text });
        e.dataTransfer.setData('text/plain', text);
        item.classList.add('is-dragging', 'drag-placeholder');
      });

      container.addEventListener('dragend', function (e) {
        var item = e.target.closest('.category-item');
        if (item) item.classList.remove('is-dragging', 'drag-placeholder');
        document.querySelectorAll('.category-item.drag-over, .so-what-item.drag-over').forEach(function (el) {
          el.classList.remove('drag-over');
        });
        clearLaneHighlights();
      });

      container.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        document.querySelectorAll('.category-item.drag-over').forEach(function (el) {
          el.classList.remove('drag-over');
        });
        var item = e.target.closest('.category-item');
        if (item) item.classList.add('drag-over');
      });

      container.addEventListener('dragleave', function (e) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          e.currentTarget.querySelectorAll('.drag-over').forEach(function (el) {
            el.classList.remove('drag-over');
          });
        }
      });

      container.addEventListener('drop', function (e) {
        e.preventDefault();
        var payload = getPayload(e);
        if (!payload.id) return;
        var dropTarget = e.target.closest('.category-item');
        var draggedEl = document.querySelector('.category-item.is-dragging, .so-what-item.is-dragging');
        var state = getStateFromDOM();
        removeItemById(state, payload.id);

        var arr = state[category] || [];
        var insertIndex = arr.length;
        if (payload.sourceType === 'category' && payload.sourceKey === category && draggedEl && container.contains(draggedEl)) {
          var children = Array.from(container.children).filter(function (c) { return c.classList.contains('category-item') || c.classList.contains('so-what-item'); });
          var idx = dropTarget ? children.indexOf(dropTarget) : children.length;
          var draggedIdx = children.indexOf(draggedEl);
          insertIndex = (draggedIdx >= 0 && draggedIdx < idx) ? Math.max(0, idx - 1) : idx;
        } else if (dropTarget) {
          insertIndex = Array.from(container.querySelectorAll('.category-item, .so-what-item')).indexOf(dropTarget);
          if (insertIndex < 0) insertIndex = arr.length;
        }
        arr.splice(insertIndex, 0, { id: payload.id, text: payload.text });
        state[category] = arr;
        doSave(state);
        render(state);
      });
    });

    document.querySelectorAll('.so-what-lane').forEach(function (laneEl) {
      var laneIndex = parseInt(laneEl.getAttribute('data-lane'), 10);
      var laneItems = laneEl.querySelector('.so-what-lane-items');
      if (!laneItems) return;

      laneEl.addEventListener('dragenter', function (e) {
        e.preventDefault();
        if (e.target.closest('.so-what-lane') !== laneEl) return;
        clearLaneHighlights();
        laneEl.classList.add('lane-highlight');
      });

      laneEl.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        soWhatAutoScroll(e);
        clearLaneHighlights();
        laneEl.classList.add('lane-highlight');

        var item = e.target.closest('.so-what-item');
        if (item) {
          ensureInsertionIndicator(laneItems, item);
        } else {
          ensureInsertionIndicator(laneItems, null);
        }
      });

      laneEl.addEventListener('dragleave', function (e) {
        if (laneEl.contains(e.relatedTarget)) return;
        laneEl.classList.remove('lane-highlight');
        laneItems.querySelectorAll('.drop-insertion').forEach(function (el) { el.remove(); });
      });

      laneEl.addEventListener('drop', function (e) {
        e.preventDefault();
        var payload = getPayload(e);
        if (!payload.id) return;

        var dropTarget = e.target.closest('.so-what-item');
        var state = getStateFromDOM();
        removeItemById(state, payload.id);
        var laneArr = state.soWhatLanes[laneIndex] || [];
        var insertIndex = dropTarget ? Array.from(laneItems.querySelectorAll('.so-what-item')).indexOf(dropTarget) : laneArr.length;
        if (insertIndex < 0) insertIndex = laneArr.length;
        laneArr.splice(insertIndex, 0, { id: payload.id, text: payload.text });
        state.soWhatLanes[laneIndex] = laneArr;
        doSave(state);
        render(state);
        clearLaneHighlights();
      });
    });

    document.querySelectorAll('.so-what-lane .so-what-lane-items').forEach(function (laneItems) {
      var laneEl = laneItems.closest('.so-what-lane');
      var laneIndex = parseInt(laneEl.getAttribute('data-lane'), 10);

      laneItems.addEventListener('dragstart', function (e) {
        var item = e.target.closest('.so-what-item');
        if (!item) return;
        var id = item.getAttribute('data-item-id');
        var text = item.getAttribute('data-text') || item.textContent.trim();
        e.dataTransfer.effectAllowed = 'move';
        setPayload(e, { sourceType: 'soWhat', sourceLane: laneIndex, id: id, text: text });
        e.dataTransfer.setData('text/plain', text);
        item.classList.add('is-dragging');
      });

      laneItems.addEventListener('dragend', function (e) {
        var item = e.target.closest('.so-what-item');
        if (item) item.classList.remove('is-dragging');
        document.querySelectorAll('.so-what-item.drag-over').forEach(function (el) {
          el.classList.remove('drag-over');
        });
        clearLaneHighlights();
      });

      laneItems.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        soWhatAutoScroll(e);
        var item = e.target.closest('.so-what-item');
        document.querySelectorAll('.so-what-item.drag-over').forEach(function (el) {
          el.classList.remove('drag-over');
        });
        if (item) item.classList.add('drag-over');
      });

      laneItems.addEventListener('dragleave', function (e) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          e.currentTarget.querySelectorAll('.drag-over').forEach(function (el) {
            el.classList.remove('drag-over');
          });
        }
      });

      laneItems.addEventListener('drop', function (e) {
        e.preventDefault();
        var payload = getPayload(e);
        if (!payload.id) return;

        var dropTarget = e.target.closest('.so-what-item');
        var draggedEl = document.querySelector('.so-what-item.is-dragging');
        var state = getStateFromDOM();
        removeItemById(state, payload.id);
        var laneArr = state.soWhatLanes[laneIndex] || [];
        var items = Array.from(laneItems.querySelectorAll('.so-what-item'));
        var idx = dropTarget ? items.indexOf(dropTarget) : items.length;
        var draggedIdx = items.indexOf(draggedEl);
        var insertIndex = (draggedIdx >= 0 && draggedIdx < idx) ? Math.max(0, idx - 1) : idx;
        if (insertIndex < 0) insertIndex = laneArr.length;
        laneArr.splice(insertIndex, 0, { id: payload.id, text: payload.text });
        state.soWhatLanes[laneIndex] = laneArr;
        doSave(state);
        render(state);
        clearLaneHighlights();
      });
    });
  }

  function doSave(state) {
    saveToStorage(state);
    saveToServer(state);
  }

  function buildHypothesisFileContent(soWhatLanes) {
    var lines = ['So What?'];
    var lanes = soWhatLanes || [[], [], [], [], [], []];
    lanes.forEach(function (lane) {
      (lane || []).forEach(function (item) {
        var text = (item && item.text != null) ? String(item.text).trim() : '';
        if (text) lines.push('- ' + text);
      });
    });
    return lines.join('\n');
  }

  function saveHypothesisToServer(content, callback) {
    if (typeof callback !== 'function') callback = function () {};
    fetch('/api/save-hypothesis', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: content
    }).then(function (r) {
      if (r.ok) callback(null);
      else callback(new Error('Save failed'));
    }).catch(callback);
  }

  function setupSaveHypothesisButton() {
    var btn = document.querySelector('.btn-save-hypothesis');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var state = getStateFromDOM();
      var soWhatLanes = state.soWhatLanes || [[], [], [], [], [], []];
      var content = buildHypothesisFileContent(soWhatLanes);
      var label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      saveHypothesisToServer(content, function (err) {
        btn.disabled = false;
        btn.textContent = label;
        if (err) {
          alert('Could not save hypothesis file. Make sure you open the app from the server (http://localhost:8082) and that the server is running (node server.js). If the problem persists, try restarting the node server with the script Structured-Analytic-Techniques\\start-all.js');
          return;
        }
        btn.textContent = 'Saved!';
        setTimeout(function () { btn.textContent = label; }, 1500);
      });
    });
  }

  window.cleanBoard = function () {
    var state = emptyState();
    render(state);
    setupDragAndDrop(state);
  };

  window.refreshFromIndicators = function () {
    var btn = document.getElementById('btn-refresh');
    if (btn) { btn.disabled = true; btn.textContent = 'Refreshing…'; }
    fetch(INDICATORS_FILE)
      .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('Not found')); })
      .then(function (text) {
        var parsed = parseJsonlIndicators(text);
        var current = getStateFromDOM();
        var merged = mergeIndicatorsIntoState(current, parsed);
        doSave(merged);
        render(merged);
      })
      .catch(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Refresh from hypothesis_keywords.jsonl'; }
      })
      .then(function () {
        if (btn) { btn.disabled = false; btn.textContent = 'Refresh from hypothesis_keywords.jsonl'; }
      });
  };

  function init() {
    var state = loadFromStorage();
    if (state && hasAnyItems(state)) {
      state = normalizeState(state);
      render(state);
      setupDragAndDrop(state);
      var btn = document.getElementById('btn-refresh');
      if (btn) btn.addEventListener('click', window.refreshFromIndicators);
      var btnClean = document.getElementById('btn-clean');
      if (btnClean) btnClean.addEventListener('click', window.cleanBoard);
      return;
    }

    function useState(s) {
      s = normalizeState(s);
      doSave(s);
      render(s);
      setupDragAndDrop(s);
      var btn = document.getElementById('btn-refresh');
      if (btn) btn.addEventListener('click', window.refreshFromIndicators);
      var btnClean = document.getElementById('btn-clean');
      if (btnClean) btnClean.addEventListener('click', window.cleanBoard);
    }

    fetch(CIRCLEBOARD_DATA_FILE)
      .then(function (r) {
        if (r.ok) return r.text();
        return Promise.reject(new Error('No CircleboardData.txt'));
      })
      .then(function (text) {
        try {
          var o = JSON.parse(text);
          useState(o);
        } catch (e) {
          return Promise.reject(e);
        }
      })
      .catch(function () {
        return fetch(INDICATORS_FILE)
          .then(function (r) { return r.ok ? r.text() : Promise.reject(new Error('No hypothesis_keywords.jsonl')); })
          .then(function (text) {
            var parsed = parseJsonlIndicators(text);
            useState(parsed);
          });
      })
      .catch(function () {
        var embedded = typeof window.INDICATORS_DATA === 'object' && window.INDICATORS_DATA;
        state = embedded ? {
          who: embedded.who || [],
          what: embedded.what || [],
          where: embedded.where || [],
          when: embedded.when || [],
          why: embedded.why || [],
          how: embedded.how || []
        } : emptyState();
        useState(state);
      });
  }

  function setupHideShowButtons() {
    document.querySelectorAll('.btn-hide').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = btn.closest('.category-box') || btn.closest('.so-what-box') || btn.closest('.trash-box');
        if (box) {
          box.classList.add('is-hidden');
        }
      });
    });
    document.querySelectorAll('.btn-show').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = btn.closest('.category-box') || btn.closest('.so-what-box') || btn.closest('.trash-box');
        if (box) {
          box.classList.remove('is-hidden');
        }
      });
    });
  }

  function setupAddButtons() {
    var modal = document.getElementById('add-modal');
    var titleEl = modal && modal.querySelector('.add-modal-title');
    var inputEl = document.getElementById('add-modal-input');
    var addBtn = modal && modal.querySelector('.add-modal-add');
    var cancelBtn = modal && modal.querySelector('.add-modal-cancel');
    var backdrop = modal && modal.querySelector('.add-modal-backdrop');
    var addTarget = null;

    function openModal(target, questionTitle, placeholderText) {
      addTarget = target;
      if (titleEl) titleEl.textContent = questionTitle;
      if (inputEl) {
        inputEl.placeholder = placeholderText || '';
        inputEl.value = '';
      }
      if (modal) {
        modal.removeAttribute('hidden');
        if (inputEl) {
          setTimeout(function () { inputEl.focus(); }, 50);
        }
      }
    }

    function closeModal() {
      addTarget = null;
      if (inputEl) inputEl.value = '';
      if (modal) modal.setAttribute('hidden', '');
    }

    function submitAdd() {
      var text = inputEl ? inputEl.value.trim() : '';
      var state = getStateFromDOM();
      state = normalizeState(state);
      if (!addTarget) { closeModal(); return; }
      var item = { id: genId(), text: text || '(new item)' };
      if (addTarget === 'so-what') {
        state.soWhatLanes = state.soWhatLanes || [[], [], [], [], [], []];
        state.soWhatLanes[0] = (state.soWhatLanes[0] || []).concat(item);
      } else if (CATEGORY_KEYS.indexOf(addTarget) !== -1) {
        state[addTarget] = (state[addTarget] || []).concat(item);
      }
      doSave(state);
      render(state);
      closeModal();
    }

    document.querySelectorAll('.btn-add').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = btn.closest('.category-box') || btn.closest('.so-what-box');
        if (!box) return;
        var target = btn.getAttribute('data-add-target');
        var headerEl = box.querySelector('.category-header') || box.querySelector('.so-what-header');
        var helpEl = box.querySelector('.category-help') || box.querySelector('.so-what-help');
        var questionTitle = headerEl ? headerEl.textContent.trim() : (target || 'Add');
        var placeholderText = helpEl ? helpEl.textContent.trim() : '';
        openModal(target, questionTitle, placeholderText);
      });
    });

    if (addBtn) addBtn.addEventListener('click', submitAdd);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
    if (backdrop) backdrop.addEventListener('click', closeModal);
    if (inputEl) {
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submitAdd();
        }
        if (e.key === 'Escape') closeModal();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      setupHideShowButtons();
      setupAddButtons();
      setupSaveHypothesisButton();
      init();
    });
  } else {
    setupHideShowButtons();
    setupAddButtons();
    setupSaveHypothesisButton();
    init();
  }
})();
