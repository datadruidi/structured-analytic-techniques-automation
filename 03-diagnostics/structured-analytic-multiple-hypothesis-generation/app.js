(function () {
  'use strict';

  const SOURCE_FILE = 'input/Multiple_Hypothesis_Generation.txt';
  const STORAGE_KEY_GENERATION = 'hypothesis-generation-state';
  const STORAGE_KEY_RANKING = 'hypothesis-ranking-state';
  const STORAGE_KEY_PAGE = 'hypothesis-current-page';
  const STORAGE_KEY_TREE_COLUMNS = 'hypothesis-tree-column-widths';
  const TREE_COLUMN_MIN = 80;

  /** @typedef {{ id: string, label: string, editValue?: string }} Why */
  /** @typedef {{ id: string, label: string, whys: Why[] }} What */
  /** @typedef {{ id: string, label: string, whats: What[] }} Who */

  let sourceItems = [];
  /** @type {Who[]} */
  let groups = [];
  let pendingGenerateLabel = null;
  const permutationDirtyIds = new Set();
  const resizeObservers = new Set();
  /** Column widths in px: { who, what, why } — perm is 1fr */
  let treeColumnWidths = { who: 180, what: 140, why: 200 };

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const sourceListEl = $('#source-list');
  const btnAddSource = $('#btn-add-source');
  const btnUpdateSource = $('#btn-update-source');
  const destinationPopup = $('#destination-popup');
  const destinationPopupBackdrop = $('#destination-popup-backdrop');
  const destinationPopupItemPreview = $('#destination-popup-item-preview');
  const destinationPopupCancel = $('#destination-popup-cancel');
  const addSourceModal = $('#add-source-modal');
  const addSourceModalBackdrop = $('#add-source-modal-backdrop');
  const addSourceInput = $('#add-source-input');
  const addSourceCancel = $('#add-source-cancel');
  const addSourceAdd = $('#add-source-add');
  const treeContent = $('#tree-content');
  const treeViewport = $('#tree-viewport');
  const treeEmptyHint = $('#tree-empty-hint');
  const btnClearTree = $('#btn-clear-tree');
  const btnUpdateTree = $('#btn-update-tree');

  function newId() {
    return typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** Deep clone a Who and regenerate all IDs. No shared references. */
  function cloneWho(who) {
    const clone = structuredClone(who);
    function regenerateIds(w) {
      w.id = newId();
      (w.whats || []).forEach((what) => {
        what.id = newId();
        (what.whys || []).forEach((why) => {
          why.id = newId();
        });
      });
    }
    regenerateIds(clone);
    return clone;
  }

  let savedGenerationScrollTop = 0;

  function saveGenerationState() {
    try {
      var scrollTop = 0;
      if (treeViewport) scrollTop = treeViewport.scrollTop;
      localStorage.setItem(STORAGE_KEY_GENERATION, JSON.stringify({ groups: groups, scrollTop: scrollTop }));
    } catch (e) {}
  }

  function loadGenerationState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_GENERATION);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.groups) && data.groups.length > 0) {
        groups = data.groups;
      }
      if (data && typeof data.scrollTop === 'number' && data.scrollTop >= 0) {
        savedGenerationScrollTop = data.scrollTop;
      }
    } catch (e) {}
  }

  function applySavedGenerationScroll() {
    if (!treeViewport || !savedGenerationScrollTop) return;
    var top = savedGenerationScrollTop;
    savedGenerationScrollTop = 0;
    requestAnimationFrame(function () {
      treeViewport.scrollTop = top;
    });
  }

  function clearTree() {
    groups = [];
    permutationDirtyIds.clear();
    buildTreeView();
    renderSourceList();
    fetch('/api/clear-hypotheses', { method: 'POST' }).catch(function () {});
  }

  /** Copy What/Why structure from the fullest Who to others; sync all levels (add missing Whats and missing Whys per What); new IDs for all copies. */
  function updateTreeFromReference() {
    if (groups.length === 0) return;
    const reference = groups.reduce((a, b) =>
      (b.whats || []).length >= (a.whats || []).length ? b : a
    );
    const refWhats = reference.whats || [];
    if (refWhats.length === 0) return;
    groups.forEach((who) => {
      const current = who.whats || [];
      const hasWhatLabel = (lbl) => current.some((w) => (w.label || '').trim() === (lbl || '').trim());
      for (let i = current.length; i < refWhats.length; i++) {
        const refWhat = refWhats[i];
        const refLabel = (refWhat.label || '').trim();
        if (hasWhatLabel(refLabel)) continue;
        const copyWhat = {
          id: newId(),
          label: refWhat.label,
          whys: (refWhat.whys || []).map((refWhy) => ({
            id: newId(),
            label: refWhy.label,
            editValue: refWhy.editValue !== undefined ? refWhy.editValue : ''
          }))
        };
        who.whats.push(copyWhat);
      }
      for (let i = 0; i < refWhats.length; i++) {
        const what = who.whats[i];
        const refWhat = refWhats[i];
        if (!what || !refWhat) continue;
        if (!what.whys) what.whys = [];
        const refWhys = refWhat.whys || [];
        const hasWhyLabel = (lbl) => what.whys.some((w) => (w.label || '').trim() === (lbl || '').trim());
        for (let j = what.whys.length; j < refWhys.length; j++) {
          const refWhy = refWhys[j];
          if (hasWhyLabel(refWhy.label)) continue;
          what.whys.push({
            id: newId(),
            label: refWhy.label,
            editValue: refWhy.editValue !== undefined ? refWhy.editValue : ''
          });
        }
      }
    });
    buildTreeView();
  }

  function getGeneratedSet() {
    const set = new Set();
    groups.forEach((who) => {
      set.add(who.label);
      (who.whats || []).forEach((what) => {
        set.add(what.label);
        (what.whys || []).forEach((why) => set.add(why.label));
      });
    });
    return set;
  }

  function parseSourceFile(text) {
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
      if (line === 'So What?') continue;
      const label = line.replace(/^\s*-\s*/, '').trim();
      if (label) items.push(label);
    }
    return items;
  }

  function loadSourceFile() {
    return fetch(SOURCE_FILE)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('Could not load file'))))
      .then((text) => {
        sourceItems = parseSourceFile(text);
        renderSourceList();
      })
      .catch(() => {
        sourceItems = [];
        renderSourceList();
      });
  }

  /** Re-read the source file and append any new items (keeps existing items). */
  function updateSourceFromFile() {
    fetch(SOURCE_FILE)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('Could not load file'))))
      .then((text) => {
        const fileItems = parseSourceFile(text);
        const existing = new Set(sourceItems);
        fileItems.forEach((label) => {
          if (!existing.has(label)) {
            sourceItems.push(label);
            existing.add(label);
          }
        });
        renderSourceList();
      })
      .catch(() => {});
  }

  function renderSourceList() {
    const generated = getGeneratedSet();
    sourceListEl.innerHTML = '';
    sourceItems.forEach((text, index) => {
      const li = document.createElement('li');
      li.className = 'source-item';
      li.dataset.index = String(index);
      const label = document.createElement('span');
      label.className = 'source-item-label';
      label.textContent = text;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-generate' + (generated.has(text) ? ' is-generated' : '');
      btn.textContent = generated.has(text) ? 'Generated' : 'Generate';
      btn.addEventListener('click', () => openDestinationPopup(text));
      const btnDeleteSource = document.createElement('button');
      btnDeleteSource.type = 'button';
      btnDeleteSource.className = 'btn-source-delete';
      btnDeleteSource.innerHTML = '&#128465;';
      btnDeleteSource.setAttribute('aria-label', 'Remove this source item');
      btnDeleteSource.title = 'Remove';
      btnDeleteSource.addEventListener('click', () => removeSourceItem(index));
      li.appendChild(label);
      li.appendChild(btn);
      li.appendChild(btnDeleteSource);
      sourceListEl.appendChild(li);
    });
  }

  function openDestinationPopup(label) {
    pendingGenerateLabel = label;
    if (destinationPopupItemPreview) destinationPopupItemPreview.textContent = label;
    var destWho = document.getElementById('dest-who');
    var destWhat = document.getElementById('dest-what');
    var destWhy = document.getElementById('dest-why');
    if (destWho) destWho.disabled = false;
    if (destWhat) destWhat.disabled = groups.length === 0;
    if (destWhy) destWhy.disabled = !groups.some(function (w) { return (w.whats || []).length > 0; });
    if (destinationPopup) {
      destinationPopup.hidden = false;
      destinationPopup.removeAttribute('hidden');
    }
  }

  function applyDestination(dest) {
    if (pendingGenerateLabel && dest) addToTree(dest, pendingGenerateLabel);
    closeDestinationPopup();
  }

  function closeDestinationPopup() {
    pendingGenerateLabel = null;
    if (destinationPopup) {
      destinationPopup.hidden = true;
      destinationPopup.setAttribute('hidden', '');
    }
  }

  /** Add item: Who = new group; What = one under every Who; Why = one under every What. No duplicate labels at the same level (same What label per Who, same Why label per What). */
  function addToTree(depth, label) {
    const trimmed = (label || '').trim();
    if (!trimmed || !['who', 'what', 'why'].includes(depth)) return;
    if (depth === 'who') {
      groups.push({ id: newId(), label: trimmed, whats: [] });
    } else if (depth === 'what') {
      groups.forEach((who) => {
        const whats = who.whats || [];
        const hasSame = whats.some((w) => (w.label || '').trim() === trimmed);
        if (!hasSame) who.whats.push({ id: newId(), label: trimmed, whys: [] });
      });
    } else if (depth === 'why') {
      groups.forEach((who) => {
        (who.whats || []).forEach((what) => {
          const whys = what.whys || [];
          const hasSame = whys.some((w) => (w.label || '').trim() === trimmed);
          if (!hasSame) what.whys.push({ id: newId(), label: trimmed, editValue: '' });
        });
      });
    }
    buildTreeView();
    renderSourceList();
  }

  function loadTreeColumnWidths() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TREE_COLUMNS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.who === 'number' && typeof parsed.what === 'number' && typeof parsed.why === 'number') {
          treeColumnWidths = {
            who: Math.max(TREE_COLUMN_MIN, parsed.who),
            what: Math.max(TREE_COLUMN_MIN, parsed.what),
            why: Math.max(TREE_COLUMN_MIN, parsed.why)
          };
        }
      }
    } catch (e) {}
  }

  function saveTreeColumnWidths() {
    try {
      localStorage.setItem(STORAGE_KEY_TREE_COLUMNS, JSON.stringify(treeColumnWidths));
    } catch (e) {}
  }

  function applyTreeColumnWidths(container) {
    if (!container) return;
    container.style.setProperty('--tree-who-width', treeColumnWidths.who + 'px');
    container.style.setProperty('--tree-what-width', treeColumnWidths.what + 'px');
    container.style.setProperty('--tree-why-width', treeColumnWidths.why + 'px');
  }

  function setupTreeColumnResizer(container, resizerEl, index) {
    if (!container || !resizerEl) return;
    let startX = 0;
    let startWho = 0;
    let startWhat = 0;
    let startWhy = 0;

    resizerEl.addEventListener('mousedown', function (e) {
      e.preventDefault();
      startX = e.clientX;
      startWho = treeColumnWidths.who;
      startWhat = treeColumnWidths.what;
      startWhy = treeColumnWidths.why;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e) {
        const rect = container.getBoundingClientRect();
        const totalW = rect.width;
        const dx = e.clientX - startX;
        const min = TREE_COLUMN_MIN;
        if (index === 1) {
          const newWho = Math.min(Math.max(min, startWho + dx), totalW - min * 3);
          treeColumnWidths.who = newWho;
        } else if (index === 2) {
          const newWhat = Math.min(Math.max(min, startWhat + dx), totalW - treeColumnWidths.who - min * 2);
          treeColumnWidths.what = newWhat;
        } else if (index === 3) {
          const newWhy = Math.min(Math.max(min, startWhy + dx), totalW - treeColumnWidths.who - treeColumnWidths.what - min);
          treeColumnWidths.why = newWhy;
        }
        applyTreeColumnWidths(container);
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveTreeColumnWidths();
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /**
   * Branch-scoped rendering. Each Who → Group with WhoCol + Branches.
   * Each Branch = WhatNode + WhyStack (per-What) + EditCol.
   * No global Why column; WhyStack lives inside each Branch.
   */
  function buildTreeView() {
    const container = document.getElementById('tree-content');
    if (!container) return;
    container.innerHTML = '';
    resizeObservers.forEach((ro) => ro.disconnect());
    resizeObservers.clear();

    if (treeEmptyHint) treeEmptyHint.hidden = groups.length > 0;
    if (groups.length === 0) return;

    loadTreeColumnWidths();
    applyTreeColumnWidths(container);

    const header = document.createElement('div');
    header.className = 'tree-header';
    const whoCell = document.createElement('span');
    whoCell.className = 'tree-header-cell tree-header-who';
    whoCell.textContent = 'Who';
    const resizer1 = document.createElement('div');
    resizer1.className = 'tree-resizer';
    resizer1.setAttribute('aria-label', 'Resize Who / What boundary');
    resizer1.style.gridColumn = '2';
    const whatCell = document.createElement('span');
    whatCell.className = 'tree-header-cell tree-header-what';
    whatCell.textContent = 'What';
    const resizer2 = document.createElement('div');
    resizer2.className = 'tree-resizer';
    resizer2.setAttribute('aria-label', 'Resize What / Why boundary');
    resizer2.style.gridColumn = '4';
    const whyCell = document.createElement('span');
    whyCell.className = 'tree-header-cell tree-header-why';
    whyCell.textContent = 'Why?';
    const resizer3 = document.createElement('div');
    resizer3.className = 'tree-resizer';
    resizer3.setAttribute('aria-label', 'Resize Why / Permutations boundary');
    resizer3.style.gridColumn = '6';
    const permCell = document.createElement('span');
    permCell.className = 'tree-header-cell tree-header-perm';
    permCell.textContent = 'Permutations';
    header.appendChild(whoCell);
    header.appendChild(resizer1);
    header.appendChild(whatCell);
    header.appendChild(resizer2);
    header.appendChild(whyCell);
    header.appendChild(resizer3);
    header.appendChild(permCell);
    container.appendChild(header);

    setupTreeColumnResizer(container, resizer1, 1);
    setupTreeColumnResizer(container, resizer2, 2);
    setupTreeColumnResizer(container, resizer3, 3);

    groups.forEach((who) => {
      const group = document.createElement('div');
      group.className = 'tree-group';
      group.dataset.whoId = who.id;

      const whoCol = document.createElement('div');
      whoCol.className = 'tree-who-col';
      const whoNode = document.createElement('div');
      whoNode.className = 'tree-node tree-node-who';
      whoNode.textContent = who.label;
      whoNode.dataset.nodeId = who.id;
      whoCol.appendChild(whoNode);
      group.appendChild(whoCol);

      const branches = document.createElement('div');
      branches.className = 'tree-branches';

      (who.whats || []).forEach((what) => {
        const branch = document.createElement('div');
        branch.className = 'tree-branch';
        branch.dataset.whatId = what.id;

        const whatCol = document.createElement('div');
        whatCol.className = 'tree-what-col';
        const whatNode = document.createElement('div');
        whatNode.className = 'tree-node tree-node-what';
        whatNode.textContent = what.label;
        whatNode.dataset.nodeId = what.id;
        whatCol.appendChild(whatNode);
        branch.appendChild(whatCol);

        const branchContent = document.createElement('div');
        branchContent.className = 'tree-branch-content';

        const whyStack = document.createElement('div');
        whyStack.className = 'tree-why-stack';

        (what.whys || []).forEach((why) => {
          const whyWrap = document.createElement('div');
          whyWrap.className = 'tree-why-row';
          const whyNode = document.createElement('div');
          whyNode.className = 'tree-node tree-node-why';
          whyNode.textContent = why.label;
          whyNode.dataset.nodeId = why.id;
          whyWrap.appendChild(whyNode);
          whyStack.appendChild(whyWrap);
        });

        branchContent.appendChild(whyStack);

        const editCol = document.createElement('div');
        editCol.className = 'tree-edit-col';
        (what.whys || []).forEach((why, whyIdx) => {
          const unit = document.createElement('div');
          unit.className = 'tree-permutation-unit';
          const editRow = document.createElement('div');
          editRow.className = 'tree-edit-row';
          editRow.contentEditable = 'true';
          editRow.dataset.whyId = why.id;
          editRow.textContent = why.editValue !== undefined ? why.editValue : '';
          const saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'btn-save-hypothesis';
          saveBtn.textContent = 'Save Hypothesis';
          saveBtn.disabled = true;
          editRow.addEventListener('blur', () => {
            const w = groups.find((g) => g.id === who.id);
            const whatRef = w && w.whats ? w.whats.find((p) => p.id === what.id) : null;
            const whyRef = whatRef && whatRef.whys ? whatRef.whys.find((y) => y.id === why.id) : null;
            if (whyRef) whyRef.editValue = (editRow.textContent || '').trim();
            permutationDirtyIds.add(why.id);
            saveBtn.disabled = false;
            saveGenerationState();
          });
          editRow.addEventListener('input', () => {
            permutationDirtyIds.add(why.id);
            saveBtn.disabled = false;
          });
          saveBtn.addEventListener('click', () => {
            const permText = (editRow.textContent || '').trim();
            const w = groups.find((g) => g.id === who.id);
            const whatRef = w && w.whats ? w.whats.find((p) => p.id === what.id) : null;
            const whyRef = whatRef && whatRef.whys ? whatRef.whys.find((y) => y.id === why.id) : null;
            if (whyRef) whyRef.editValue = permText;
            fetch('/api/save-hypothesis', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title: permText })
            }).then(function (r) {
              if (r.ok) {
                permutationDirtyIds.delete(why.id);
                saveBtn.disabled = true;
              }
            }).catch(function () {});
          });
          const btnToggle = document.createElement('button');
          btnToggle.type = 'button';
          btnToggle.className = 'tree-why-toggle';
          btnToggle.setAttribute('aria-label', 'Hide permutation');
          btnToggle.textContent = '−';
          btnToggle.addEventListener('click', function () {
            unit.classList.toggle('tree-permutation-unit-hidden');
            const isHidden = unit.classList.contains('tree-permutation-unit-hidden');
            btnToggle.textContent = isHidden ? '+' : '−';
            btnToggle.setAttribute('aria-label', isHidden ? 'Show permutation' : 'Hide permutation');
          });
          unit.appendChild(editRow);
          unit.appendChild(btnToggle);
          unit.appendChild(saveBtn);
          editCol.appendChild(unit);
        });
        branchContent.appendChild(editCol);

        branch.appendChild(branchContent);
        branches.appendChild(branch);
      });

      group.appendChild(branches);

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'tree-group-edges');
      svg.setAttribute('aria-hidden', 'true');
      group.appendChild(svg);

      container.appendChild(group);

      function drawGroupEdges() {
        const whoEl = group.querySelector('.tree-node-who');
        const whatNodes = group.querySelectorAll('.tree-node-what');
        if (!whoEl || whatNodes.length === 0) return;
        const box = group.getBoundingClientRect();
        const paths = [];
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return {
            right: r.right - box.left,
            left: r.left - box.left,
            midY: (r.top + r.bottom) / 2 - box.top
          };
        };
        const curve = (from, to) => {
          const x1 = from.right;
          const y1 = from.midY;
          const x2 = to.left;
          const y2 = to.midY;
          const cx = (x1 + x2) / 2;
          return 'M' + x1 + ',' + y1 + ' C' + cx + ',' + y1 + ' ' + cx + ',' + y2 + ' ' + x2 + ',' + y2;
        };
        const whoPos = rect(whoEl);
        whatNodes.forEach((whatEl) => {
          paths.push(curve(whoPos, rect(whatEl)));
        });
        const branchEls = group.querySelectorAll('.tree-branch');
        branchEls.forEach((branchEl) => {
          const whatEl = branchEl.querySelector('.tree-node-what');
          const branchWhyNodes = branchEl.querySelectorAll('.tree-node-why');
          const editCol = branchEl.querySelector('.tree-edit-col');
          const units = editCol ? editCol.children : [];
          if (!whatEl) return;
          const whatPos = rect(whatEl);
          branchWhyNodes.forEach((whyEl) => paths.push(curve(whatPos, rect(whyEl))));
          branchWhyNodes.forEach((whyEl, i) => {
            const unit = units[i];
            if (unit) {
              const unitBox = unit.getBoundingClientRect();
              const toPos = {
                right: unitBox.right - box.left,
                left: unitBox.left - box.left,
                midY: (unitBox.top + unitBox.bottom) / 2 - box.top
              };
              const whyPos = rect(whyEl);
              paths.push(curve(whyPos, toPos));
            }
          });
        });
        const w = Math.max(box.width, 1);
        const h = Math.max(box.height, 1);
        svg.setAttribute('width', w);
        svg.setAttribute('height', h);
        svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
        let pathEl = svg.querySelector('path');
        if (!pathEl) {
          pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          pathEl.setAttribute('fill', 'none');
          pathEl.setAttribute('stroke', '#6b9bd1');
          pathEl.setAttribute('stroke-width', '1.5');
          pathEl.setAttribute('stroke-opacity', '0.7');
          svg.appendChild(pathEl);
        }
        pathEl.setAttribute('d', paths.join(' '));
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(drawGroupEdges);
      });
      const ro = new ResizeObserver(() => drawGroupEdges());
      ro.observe(group);
      resizeObservers.add(ro);
    });
    applySavedGenerationScroll();
    saveGenerationState();
  }

  function initDestinationPopup() {
    window.__hypothesisPlace = applyDestination;
    var destWho = document.getElementById('dest-who');
    var destWhat = document.getElementById('dest-what');
    var destWhy = document.getElementById('dest-why');
    if (destWho) destWho.onclick = function () { applyDestination('who'); };
    if (destWhat) destWhat.onclick = function () { applyDestination('what'); };
    if (destWhy) destWhy.onclick = function () { applyDestination('why'); };
    if (destinationPopupCancel) destinationPopupCancel.addEventListener('click', closeDestinationPopup);
    if (destinationPopupBackdrop) destinationPopupBackdrop.addEventListener('click', closeDestinationPopup);
  }

  function openAddSourceModal() {
    addSourceInput.value = '';
    addSourceModal.hidden = false;
    addSourceModal.removeAttribute('hidden');
    addSourceInput.focus();
  }

  function closeAddSourceModal() {
    addSourceModal.hidden = true;
    addSourceModal.setAttribute('hidden', '');
  }

  function addSourceItem(text) {
    const t = (text || '').trim();
    if (!t) return;
    sourceItems.push(t);
    renderSourceList();
    closeAddSourceModal();
    fetch('/api/add-source', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: t
    }).catch(function () {});
  }

  /** Remove a label from the tree at all levels (Who, What, Why). */
  function removeLabelFromTree(label) {
    const trimmed = (label || '').trim();
    if (!trimmed) return;
    groups = groups.filter((w) => (w.label || '').trim() !== trimmed);
    groups.forEach((who) => {
      if (who.whats) who.whats = who.whats.filter((w) => (w.label || '').trim() !== trimmed);
      (who.whats || []).forEach((what) => {
        if (what.whys) what.whys = what.whys.filter((y) => (y.label || '').trim() !== trimmed);
      });
    });
  }

  function removeSourceItem(index) {
    if (index < 0 || index >= sourceItems.length) return;
    const label = sourceItems[index];
    sourceItems.splice(index, 1);
    removeLabelFromTree(label);
    renderSourceList();
    buildTreeView();
    fetch('/api/source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: sourceItems })
    }).catch(function () {});
  }

  function clearSourceList() {
    sourceItems = [];
    renderSourceList();
  }

  function initUpdateSourceButton() {
    if (btnUpdateSource) btnUpdateSource.addEventListener('click', updateSourceFromFile);
    var btnClearSource = document.getElementById('btn-clear-source');
    if (btnClearSource) btnClearSource.addEventListener('click', clearSourceList);
  }

  function initAddSourceModal() {
    if (btnAddSource) btnAddSource.addEventListener('click', openAddSourceModal);
    addSourceCancel.addEventListener('click', closeAddSourceModal);
    addSourceModalBackdrop.addEventListener('click', closeAddSourceModal);
    addSourceAdd.addEventListener('click', () => addSourceItem(addSourceInput.value));
    addSourceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addSourceItem(addSourceInput.value);
      if (e.key === 'Escape') closeAddSourceModal();
    });
  }

  function initGenerationScrollSave() {
    if (!treeViewport) return;
    var scrollTimeout;
    treeViewport.addEventListener('scroll', function () {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(saveGenerationState, 150);
    });
  }

  function initClearButton() {
    if (btnClearTree) btnClearTree.addEventListener('click', clearTree);
  }

  function initUpdateButton() {
    if (btnUpdateTree) btnUpdateTree.addEventListener('click', updateTreeFromReference);
  }

  function initClearHypothesisJsonButton() {
    const btn = document.getElementById('btn-clear-hypothesis-json');
    if (!btn) return;
    btn.addEventListener('click', function () {
      fetch('/api/clear-hypotheses', { method: 'POST' })
        .then(function (r) {
          if (r.ok) {
            const label = btn.textContent;
            btn.textContent = 'Cleared';
            setTimeout(function () { btn.textContent = label; }, 2000);
          }
        })
        .catch(function () {});
    });
  }

  function updateCardTitlePreview(card) {
    if (!card) return;
    var preview = card.querySelector('.hypothesis-card-title-preview');
    if (!preview) return;
    var first = card.querySelector('.hypothesis-card-list .ranking-list-text');
    preview.textContent = first ? first.textContent : '';
  }

  function getRankingState() {
    var container = document.getElementById('hypothesis-cards-container');
    if (!container) return null;
    var cards = {};
    container.querySelectorAll('.hypothesis-card').forEach(function (card) {
      var id = card.dataset.hypothesisId;
      if (!id) return;
      var titleItems = [];
      var itemHypIds = [];
      card.querySelectorAll('.hypothesis-card-list .hypothesis-card-item').forEach(function (li) {
        var span = li.querySelector('.ranking-list-text');
        titleItems.push(span ? span.textContent : '');
        itemHypIds.push(li.dataset.hypothesisId || '');
      });
      var descEl = card.querySelector('.hypothesis-card-description');
      var description = descEl ? descEl.value : '';
      cards[id] = {
        collapsed: card.classList.contains('is-collapsed'),
        titleItems: titleItems,
        itemHypIds: itemHypIds,
        description: description
      };
    });
    return { cards: cards };
  }

  function saveRankingState() {
    try {
      var state = getRankingState();
      if (state) localStorage.setItem(STORAGE_KEY_RANKING, JSON.stringify(state));
    } catch (e) {}
  }

  function restoreRankingState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY_RANKING);
      if (!raw) return;
      var state = JSON.parse(raw);
      if (!state || !state.cards) return;
      var container = document.getElementById('hypothesis-cards-container');
      if (!container) return;
      container.querySelectorAll('.hypothesis-card').forEach(function (card) {
        var id = card.dataset.hypothesisId;
        if (!id) return;
        var saved = state.cards[id];
        if (!saved) return;
        var listEl = card.querySelector('.hypothesis-card-list');
        if (listEl && Array.isArray(saved.titleItems)) {
          listEl.innerHTML = '';
          var hypIds = Array.isArray(saved.itemHypIds) ? saved.itemHypIds : [];
          saved.titleItems.forEach(function (text, idx) {
            var li = document.createElement('li');
            li.className = 'ranking-list-item hypothesis-card-item';
            if (hypIds[idx]) li.dataset.hypothesisId = hypIds[idx];
            var textSpan = document.createElement('span');
            textSpan.className = 'ranking-list-text';
            textSpan.textContent = text;
            var btnRemove = document.createElement('button');
            btnRemove.type = 'button';
            btnRemove.className = 'btn-ranking-remove';
            btnRemove.textContent = '\u00d7';
            btnRemove.setAttribute('aria-label', 'Remove from card');
            btnRemove.addEventListener('click', function () {
              var card = listEl.closest('.hypothesis-card');
              li.remove();
              updateCardTitlePreview(card);
              saveRankingState();
            });
            li.appendChild(textSpan);
            li.appendChild(btnRemove);
            listEl.appendChild(li);
          });
        }
        var descEl = card.querySelector('.hypothesis-card-description');
        if (descEl && typeof saved.description === 'string') descEl.value = saved.description;
        var toggleBtn = card.querySelector('.hypothesis-card-toggle');
        if (saved.collapsed) {
          card.classList.add('is-collapsed');
          if (toggleBtn) {
            toggleBtn.textContent = 'Show';
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.setAttribute('aria-label', 'Show hypothesis');
          }
        } else {
          card.classList.remove('is-collapsed');
          if (toggleBtn) {
            toggleBtn.textContent = 'Hide';
            toggleBtn.setAttribute('aria-expanded', 'true');
            toggleBtn.setAttribute('aria-label', 'Hide hypothesis');
          }
        }
      });
      container.querySelectorAll('.hypothesis-card').forEach(function (card) { updateCardTitlePreview(card); });
    } catch (e) {}
  }

  function loadHypothesesFile() {
    var listEl = document.getElementById('ranking-list');
    if (!listEl) return;
    fetch('/api/hypothesis-ach')
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('Could not load')); })
      .then(function (data) {
        var hypotheses = Array.isArray(data.hypotheses) ? data.hypotheses : [];
        var items = hypotheses.filter(function (h) { return h && h.title; }).map(function (h) {
          return { hypothesisId: h.id || '', title: String(h.title) };
        });
        renderRankingList(items);
        restoreRankingState();
        var irEl = document.getElementById('intelligence-requirement-input-ranking');
        if (irEl && data.intelligence_requirement != null) irEl.value = String(data.intelligence_requirement);
      })
      .catch(function () {
        renderRankingList([], true);
        restoreRankingState();
      });
  }

  function clearRankingPage() {
    renderRankingList([]);
    var container = document.getElementById('hypothesis-cards-container');
    if (container) {
      container.querySelectorAll('.hypothesis-card').forEach(function (card) {
        var listEl = card.querySelector('.hypothesis-card-list');
        if (listEl) listEl.innerHTML = '';
        var descEl = card.querySelector('.hypothesis-card-description');
        if (descEl) descEl.value = '';
        card.classList.add('is-collapsed');
        var toggleBtn = card.querySelector('.hypothesis-card-toggle');
        if (toggleBtn) {
          toggleBtn.textContent = 'Show';
          toggleBtn.setAttribute('aria-expanded', 'false');
          toggleBtn.setAttribute('aria-label', 'Show hypothesis');
        }
      });
    }
    var irEl = document.getElementById('intelligence-requirement-input-ranking');
    if (irEl) irEl.value = '';
    if (container) container.querySelectorAll('.hypothesis-card').forEach(function (card) { updateCardTitlePreview(card); });
    try {
      localStorage.removeItem(STORAGE_KEY_RANKING);
    } catch (e) {}
  }

  function createDragPreview(el, text) {
    var ghost = document.createElement('div');
    ghost.className = 'drag-preview';
    ghost.textContent = text;
    ghost.style.width = el.offsetWidth + 'px';
    document.body.appendChild(ghost);
    return ghost;
  }

  function renderRankingList(items) {
    var listEl = document.getElementById('ranking-list');
    if (!listEl) return;
    listEl.innerHTML = '';
    // items: array of { hypothesisId, title } or plain strings (backward compat)
    items.forEach(function (item, index) {
      var title = typeof item === 'string' ? item : (item.title || '');
      var hypothesisId = typeof item === 'object' && item.hypothesisId ? item.hypothesisId : '';
      var li = document.createElement('li');
      li.className = 'ranking-list-item';
      li.dataset.lineIndex = String(index);
      if (hypothesisId) li.dataset.hypothesisId = hypothesisId;
      li.setAttribute('draggable', 'true');
      li.setAttribute('aria-label', 'Hypothesis; drag to card on the right');
      var textSpan = document.createElement('span');
      textSpan.className = 'ranking-list-text';
      textSpan.textContent = title;
      var btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'btn-ranking-edit';
      btnEdit.textContent = 'Edit';
      btnEdit.setAttribute('aria-label', 'Edit this hypothesis');
      btnEdit.addEventListener('click', function (e) {
        e.stopPropagation();
        var currentIndex = Array.prototype.indexOf.call(listEl.children, li);
        enterEditMode(li, currentIndex >= 0 ? currentIndex : index, title);
      });
      li.appendChild(textSpan);
      li.appendChild(btnEdit);
      li.addEventListener('dragstart', function (e) {
        if (e.target.closest('button') || e.target.closest('input')) return;
        var text = title;
        var span = li.querySelector('.ranking-list-text');
        if (span) text = span.textContent;
        var input = li.querySelector('.ranking-edit-input');
        if (input) text = input.value;
        e.dataTransfer.setData('text/plain', text);
        e.dataTransfer.setData('application/x-source-list', 'ranking-list');
        e.dataTransfer.setData('application/x-source-index', String(Array.prototype.indexOf.call(listEl.children, li)));
        e.dataTransfer.setData('application/x-hypothesis-id', li.dataset.hypothesisId || '');
        e.dataTransfer.effectAllowed = 'copyMove';
        var ghost = createDragPreview(li, text);
        var rect = li.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        e.dataTransfer.setDragImage(ghost, Math.min(x, ghost.offsetWidth - 4), Math.min(y, ghost.offsetHeight - 4));
        li.classList.add('is-dragging');
        setTimeout(function () { ghost.remove(); }, 0);
      });
      li.addEventListener('dragend', function () {
        li.classList.remove('is-dragging');
        listEl.querySelectorAll('.ranking-list-item').forEach(function (el) { el.classList.remove('is-drop-target'); });
      });

      li.addEventListener('dragover', function (e) {
        if (e.dataTransfer.types.indexOf('application/x-source-list') === -1) return;
        if (li.classList.contains('is-dragging')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        li.classList.add('is-drop-target');
      });
      li.addEventListener('dragleave', function (e) {
        if (!li.contains(e.relatedTarget)) li.classList.remove('is-drop-target');
      });
      li.addEventListener('drop', function (e) {
        li.classList.remove('is-drop-target');
        if (e.dataTransfer.getData('application/x-source-list') !== 'ranking-list') return;
        e.preventDefault();
        var sourceIndex = parseInt(e.dataTransfer.getData('application/x-source-index'), 10);
        if (Number.isNaN(sourceIndex)) return;
        var draggedLi = listEl.children[sourceIndex];
        if (!draggedLi || draggedLi === li) return;
        draggedLi.parentNode.removeChild(draggedLi);
        listEl.insertBefore(draggedLi, li);
        persistRankingListOrder();
      });

      listEl.appendChild(li);
    });
  }

  function persistRankingListOrder() {
    var listEl = document.getElementById('ranking-list');
    if (!listEl) return;
    var lines = [];
    for (var i = 0; i < listEl.children.length; i++) {
      var span = listEl.children[i].querySelector('.ranking-list-text');
      if (span) lines.push(span.textContent);
    }
    fetch('/api/hypotheses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: lines })
    }).catch(function () {});
  }

  var RANKING_BOX_COLORS = [
    { name: 'Default', value: '' },
    { name: 'Yellow', value: '#fef9c3' },
    { name: 'Green', value: '#dcfce7' },
    { name: 'Blue', value: '#dbeafe' },
    { name: 'Lavender', value: '#ede9fe' },
    { name: 'Peach', value: '#ffedd5' },
    { name: 'Pink', value: '#fce7f3' },
    { name: 'Mint', value: '#ccfbf1' }
  ];

  function applyRankingItemColor(li, colorValue) {
    if (colorValue) {
      li.dataset.color = colorValue;
      li.style.backgroundColor = colorValue;
    } else {
      delete li.dataset.color;
      li.style.backgroundColor = '';
    }
  }

  function enterEditMode(li, index, currentText) {
    var listEl = document.getElementById('ranking-list');
    if (!listEl) return;
    var textSpan = li.querySelector('.ranking-list-text');
    var btnEdit = li.querySelector('.btn-ranking-edit');
    if (!textSpan || !btnEdit) return;
    var savedColor = li.dataset.color || '';

    var wrap = document.createElement('div');
    wrap.className = 'ranking-edit-wrap';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'ranking-edit-input';
    input.value = currentText;
    var btnSave = document.createElement('button');
    btnSave.type = 'button';
    btnSave.className = 'btn-ranking-save';
    btnSave.textContent = 'Save';
    var btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.className = 'btn-ranking-cancel';
    btnCancel.textContent = 'Cancel';

    var colorRow = document.createElement('div');
    colorRow.className = 'ranking-edit-color-row';
    colorRow.style.display = 'none';
    var colorLabel = document.createElement('span');
    colorLabel.className = 'ranking-edit-color-label';
    colorLabel.textContent = 'Color:';
    colorRow.appendChild(colorLabel);
    RANKING_BOX_COLORS.forEach(function (opt) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ranking-color-swatch';
      btn.title = opt.name;
      btn.setAttribute('aria-label', 'Color ' + opt.name);
      if (opt.value) btn.style.backgroundColor = opt.value;
      else btn.classList.add('ranking-color-swatch--default');
      if ((opt.value || '') === savedColor) btn.classList.add('is-selected');
      btn.addEventListener('click', function () {
        colorRow.querySelectorAll('.ranking-color-swatch').forEach(function (b) { b.classList.remove('is-selected'); });
        btn.classList.add('is-selected');
        applyRankingItemColor(li, opt.value);
      });
      colorRow.appendChild(btn);
    });

    var btnToggleColors = document.createElement('button');
    btnToggleColors.type = 'button';
    btnToggleColors.className = 'btn-ranking-colors-toggle';
    btnToggleColors.textContent = 'Colors';
    btnToggleColors.setAttribute('aria-label', 'Show color options');
    btnToggleColors.setAttribute('aria-expanded', 'false');
    btnToggleColors.addEventListener('click', function () {
      var isHidden = colorRow.style.display === 'none';
      colorRow.style.display = isHidden ? 'flex' : 'none';
      btnToggleColors.textContent = isHidden ? 'Hide colors' : 'Colors';
      btnToggleColors.setAttribute('aria-label', isHidden ? 'Hide color options' : 'Show color options');
      btnToggleColors.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });

    var btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-ranking-delete';
    btnDelete.setAttribute('aria-label', 'Delete this hypothesis');
    btnDelete.innerHTML = '&#128465;';
    btnDelete.title = 'Delete';
    var textRow = document.createElement('div');
    textRow.className = 'ranking-edit-text-row';
    textRow.appendChild(input);
    textRow.appendChild(btnSave);
    textRow.appendChild(btnCancel);
    textRow.appendChild(btnToggleColors);
    textRow.appendChild(btnDelete);
    wrap.appendChild(textRow);
    wrap.appendChild(colorRow);
    textSpan.style.display = 'none';
    btnEdit.style.display = 'none';
    li.appendChild(wrap);
    input.focus();
    input.select();

    function exitEditMode(restoreText, restoreColor) {
      wrap.remove();
      textSpan.style.display = '';
      btnEdit.style.display = '';
      if (restoreText !== undefined) textSpan.textContent = restoreText;
      if (restoreColor !== undefined) applyRankingItemColor(li, restoreColor);
    }

    btnSave.addEventListener('click', function () {
      var newText = input.value;
      fetch('/api/update-hypothesis-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index: index, text: newText })
      }).then(function (r) {
        if (r.ok) {
          exitEditMode(newText);
        }
      }).catch(function () {});
    });
    btnCancel.addEventListener('click', function () {
      exitEditMode(currentText, savedColor);
    });
    btnDelete.addEventListener('click', function () {
      li.remove();
      persistRankingListOrder();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') btnSave.click();
      if (e.key === 'Escape') btnCancel.click();
    });
  }

  function showPage(pageId) {
    var gen = document.getElementById('page-generation');
    var rank = document.getElementById('page-ranking');
    var btnGen = document.getElementById('btn-page-generation');
    var btnRank = document.getElementById('btn-page-ranking');
    try {
      localStorage.setItem(STORAGE_KEY_PAGE, pageId);
    } catch (e) {}
    if (pageId === 'page-generation') {
      if (gen) { gen.classList.remove('app-page--hidden'); gen.setAttribute('aria-hidden', 'false'); }
      if (rank) { rank.classList.add('app-page--hidden'); rank.setAttribute('aria-hidden', 'true'); }
      if (btnGen) { btnGen.classList.add('is-active'); btnGen.setAttribute('aria-pressed', 'true'); }
      if (btnRank) { btnRank.classList.remove('is-active'); btnRank.setAttribute('aria-pressed', 'false'); }
    } else {
      if (rank) { rank.classList.remove('app-page--hidden'); rank.setAttribute('aria-hidden', 'false'); }
      if (gen) { gen.classList.add('app-page--hidden'); gen.setAttribute('aria-hidden', 'true'); }
      if (btnRank) { btnRank.classList.add('is-active'); btnRank.setAttribute('aria-pressed', 'true'); }
      if (btnGen) { btnGen.classList.remove('is-active'); btnGen.setAttribute('aria-pressed', 'false'); }
      loadHypothesesFile();
    }
  }

  function addDropZoneToWrap(wrap) {
    var listEl = wrap.querySelector('.hypothesis-card-list');
    if (!listEl) return;
    wrap.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      wrap.classList.add('is-drag-over');
    });
    wrap.addEventListener('dragleave', function (e) {
      if (!wrap.contains(e.relatedTarget)) wrap.classList.remove('is-drag-over');
    });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      wrap.classList.remove('is-drag-over');
      var text = e.dataTransfer.getData('text/plain');
      if (!text) return;
      var droppedHypothesisId = e.dataTransfer.getData('application/x-hypothesis-id') || '';
      var sourceList = document.getElementById('ranking-list');
      var sourceListId = e.dataTransfer.getData('application/x-source-list');
      var sourceIndexStr = e.dataTransfer.getData('application/x-source-index');
      if (sourceList && sourceListId === 'ranking-list' && sourceIndexStr !== '') {
        var idx = parseInt(sourceIndexStr, 10);
        if (!Number.isNaN(idx) && idx >= 0 && idx < sourceList.children.length) {
          sourceList.children[idx].remove();
        }
      }
      var li = document.createElement('li');
      li.className = 'ranking-list-item hypothesis-card-item';
      if (droppedHypothesisId) li.dataset.hypothesisId = droppedHypothesisId;
      var textSpan = document.createElement('span');
      textSpan.className = 'ranking-list-text';
      textSpan.textContent = text;
      var btnRemove = document.createElement('button');
      btnRemove.type = 'button';
      btnRemove.className = 'btn-ranking-remove';
      btnRemove.textContent = '\u00d7';
      btnRemove.setAttribute('aria-label', 'Remove from card');
      btnRemove.addEventListener('click', function () {
        var card = listEl.closest('.hypothesis-card');
        li.remove();
        updateCardTitlePreview(card);
        saveRankingState();
      });
      li.appendChild(textSpan);
      li.appendChild(btnRemove);
      listEl.appendChild(li);
      updateCardTitlePreview(wrap.closest('.hypothesis-card'));
      saveRankingState();
    });
  }

  function setupHypothesisCardList() {
    var wraps = document.querySelectorAll('.hypothesis-card-list-wrap');
    wraps.forEach(function (wrap) { addDropZoneToWrap(wrap); });
  }

  function loadHypothesisAchForRanking() {
    var input = document.getElementById('intelligence-requirement-input-ranking');
    if (!input) return;
    fetch('/api/hypothesis-ach').then(function (r) {
      if (!r.ok) return;
      return r.json();
    }).then(function (data) {
      if (data && data.intelligence_requirement != null) input.value = String(data.intelligence_requirement);
    }).catch(function () {});
  }

  function initSaveHypothesisAch() {
    var container = document.getElementById('hypothesis-cards-container');
    if (!container) return;
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn-save-ach');
      if (!btn) return;
      var card = btn.closest('.hypothesis-card');
      if (!card) return;
      var id = card.dataset.hypothesisId || 'H1';
      var title = '';
      var hypothesisId = '';
      var first = card.querySelector('.hypothesis-card-list .ranking-list-text');
      if (first) title = first.textContent;
      var firstItem = card.querySelector('.hypothesis-card-list .hypothesis-card-item');
      if (firstItem && firstItem.dataset.hypothesisId) hypothesisId = firstItem.dataset.hypothesisId;
      var descEl = card.querySelector('.hypothesis-card-description');
      var description = descEl ? descEl.value : '';
      var irEl = document.getElementById('intelligence-requirement-input-ranking');
      var intelligence_requirement = irEl ? irEl.value.trim() : '';
      var payload = { id: id, title: title, description: description };
      if (hypothesisId) payload.hypothesisId = hypothesisId;
      if (intelligence_requirement !== '') payload.intelligence_requirement = intelligence_requirement;
      fetch('/api/save-hypothesis-ach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) {
        if (r.ok) {
          var label = btn.textContent;
          btn.textContent = 'Saved';
          setTimeout(function () { btn.textContent = label; }, 2000);
        }
      }).catch(function () {});
    });
  }

  function initSaveAchBar(btnId, inputId) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    btn.addEventListener('click', function () {
      var irEl = document.getElementById(inputId);
      var intelligence_requirement = irEl ? irEl.value.trim() : '';
      fetch('/api/save-hypothesis-ach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ intelligence_requirement: intelligence_requirement })
      }).then(function (r) {
        if (r.ok) {
          var label = btn.textContent;
          btn.textContent = 'Saved';
          setTimeout(function () { btn.textContent = label; }, 2000);
        }
      }).catch(function () {});
    });
  }

  function initSaveAchGeneration() {
    initSaveAchBar('btn-save-ach-generation', 'intelligence-requirement-input-generation');
  }

  function initSaveAchRanking() {
    initSaveAchBar('btn-save-ach-ranking', 'intelligence-requirement-input-ranking');
  }

  function initHypothesisCardToggle() {
    var container = document.getElementById('hypothesis-cards-container');
    if (!container) return;
    container.addEventListener('click', function (e) {
      var btn = e.target.closest('.hypothesis-card-toggle');
      if (!btn) return;
      var card = btn.closest('.hypothesis-card');
      if (!card) return;
      var isCollapsed = card.classList.toggle('is-collapsed');
      btn.textContent = isCollapsed ? 'Show' : 'Hide';
      btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      btn.setAttribute('aria-label', isCollapsed ? 'Show hypothesis' : 'Hide hypothesis');
      saveRankingState();
    });
    container.addEventListener('input', function (e) {
      if (e.target.classList.contains('hypothesis-card-description')) saveRankingState();
    });
  }

  function initPageSwitcher() {
    var btnGen = document.getElementById('btn-page-generation');
    var btnRank = document.getElementById('btn-page-ranking');
    var btnRankingUpdate = document.getElementById('btn-ranking-update');
    var btnRankingClear = document.getElementById('btn-ranking-clear');
    if (btnGen) btnGen.addEventListener('click', function () { showPage('page-generation'); });
    if (btnRank) btnRank.addEventListener('click', function () { showPage('page-ranking'); });
    if (btnRankingUpdate) btnRankingUpdate.addEventListener('click', loadHypothesesFile);
    if (btnRankingClear) btnRankingClear.addEventListener('click', clearRankingPage);
  }

  function init() {
    loadGenerationState();
    loadSourceFile();
    initDestinationPopup();
    initPageSwitcher();
    setupHypothesisCardList();
    initSaveHypothesisAch();
    initSaveAchGeneration();
    initSaveAchRanking();
    initHypothesisCardToggle();
    initUpdateSourceButton();
    initAddSourceModal();
    initGenerationScrollSave();
    initClearButton();
    initUpdateButton();
    initClearHypothesisJsonButton();
    buildTreeView();
    try {
      var savedPage = localStorage.getItem(STORAGE_KEY_PAGE);
      if (savedPage === 'page-ranking') showPage('page-ranking');
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
