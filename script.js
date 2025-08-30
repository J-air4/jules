document.addEventListener('DOMContentLoaded', async () => {

    // =================================================================
    // MODULE: CONSTANTS & CONFIGURATION
    // =================================================================
    const CONSTANTS = {
        CPT_SELF_CARE: '97535',
        CPT_THERAPEUTIC: '97530',
        MAX_PROGRESS_STEPS: 11,
        LOCAL_STORAGE_KEY: 'otClinicalDocBuilderState'
    };

    // =================================================================
    // MODULE: DATA LOADING
    // =================================================================
    let clinicalData = {};
    try {
        const response = await fetch('clinicalData.json');
        if (!response.ok) throw new Error('Network response was not ok');
        clinicalData = await response.json();
    } catch (error) {
        console.error('Failed to load clinicalData.json:', error);
        showError('Critical Error: Could not load clinical data. The application cannot start.');
        return;
    }

    // =================================================================
    // MODULE: STATE MANAGEMENT
    // =================================================================
    const root = document.getElementById('root');
    let state = {};
    let notes = { selfCare: '', therapeutic: '' };
    const DOMElements = { rephraseBtn: null };

    const initialState = {
        currentStep: 1,
        activeTab: 'response',
        selectedCPTCode: null,
        selectedCategoryId: null,
        selectedSubCategoryId: null,
        selectedContext: null,
        selectedPhraseTexts: [],
        selectedReasoningText: null,
        selectedGoalText: null,
        selectedAssistanceId: null,
        selectedAssistanceLevelId: null,
        selectedJustification: null,
        usedAssistanceIds: [],
        selectedDifficultyReasons: [],
        selectedResponse: null,
        selectedOutcome: null,
        selectedPlan: null,
        sessionParams: {},
        currentNarrative: '',
        narrativeBeforeReasoning: '',
        showAssistanceModal: false,
        assistanceModalStep: 'level',
        showParametersModal: false,
        showCustomPhraseInput: false,
        history: [],
        isNewSentence: true
    };

    function updateState(newState, options = { addToHistory: true, save: true }) {
        if (options.addToHistory && state.currentStep) { // Only add to history if it's a valid step
            const oldState = { ...state };
            delete oldState.history;
            state.history.push(oldState);
        }
        state = { ...state, ...newState };
        render();
        if (options.save) saveStateToLocalStorage();
    }

    // IMPLEMENTATION: Smarter undo function to handle UI sync
    function undoState() {
        if (state.history.length > 0) {
            const prevState = state.history.pop();
            // Directly set the state without adding the current state back to history
            state = { ...prevState };
            render();
            saveStateToLocalStorage();
        }
    }


    let saveTimer;
    function saveStateToLocalStorage() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            try {
                const stateToSave = { ...state };
                delete stateToSave.history;
                localStorage.setItem(CONSTANTS.LOCAL_STORAGE_KEY, JSON.stringify({ state: stateToSave, notes }));
            } catch (e) { console.error("Failed to save state", e); }
        }, 500);
    }

    function loadStateFromLocalStorage() {
        try {
            const savedData = localStorage.getItem(CONSTANTS.LOCAL_STORAGE_KEY);
            if (savedData) {
                const parsedData = JSON.parse(savedData);
                state = { ...parsedData.state, history: [] } || initialState;
                notes = parsedData.notes || { selfCare: '', therapeutic: '' };
                return true;
            }
        } catch (e) {
            localStorage.removeItem(CONSTANTS.LOCAL_STORAGE_KEY);
        }
        return false;
    }

    // =================================================================
    // MODULE: UTILITIES
    // =================================================================
    let sessionTimer;
    let sessionTime = 0;
    function formatTime(seconds) { const mins = Math.floor(seconds / 60); const secs = seconds % 60; return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`; }
    function sanitizeForHTML(str) { if (typeof str !== 'string') return ''; const temp = document.createElement('div'); temp.textContent = str; return temp.innerHTML; }
    function sanitizeForAttribute(str) { return str.toString().replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
    function showError(message, duration = 3000) { const el = document.createElement('div'); el.textContent = message; el.setAttribute('role', 'alert'); el.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background-color:#16a34a;color:white;padding:1rem;border-radius:0.5rem;z-index:100;'; document.body.appendChild(el); setTimeout(() => el.remove(), duration); }
    function startTimer() { stopTimer(); sessionTime = state.sessionTime || 0; const timerEl = document.querySelector('.timer'); if (timerEl) timerEl.textContent = formatTime(sessionTime); sessionTimer = setInterval(() => { sessionTime++; const timerEl = document.querySelector('.timer'); if (timerEl) timerEl.textContent = formatTime(sessionTime); state.sessionTime = sessionTime; }, 1000); }
    function stopTimer() { clearInterval(sessionTimer); }
    
    function appendToNarrative(current, addition) {
        if (!current.trim()) return addition.trim();
        let narrative = current.trim();
        if (narrative.length > 0 && !/[.!?]$/.test(narrative)) {
            narrative += '.';
        }
        return `${narrative} ${addition.trim()}`;
    }
    
    function getCurrentInterventionContext() {
        if (!state.selectedCPTCode || !state.selectedCategoryId) return null;
        try {
            const isSelfCare = state.selectedCPTCode === CONSTANTS.CPT_SELF_CARE;
            const typeKey = isSelfCare ? 'self-care' : 'therapeutic';
            const category = clinicalData.interventionData[typeKey][state.selectedCategoryId];
            if (isSelfCare || !state.selectedSubCategoryId) return category;
            return category.subInterventions[state.selectedSubCategoryId];
        } catch (e) {
            console.error("Could not get current intervention context from state:", state);
            return null;
        }
    }

    // =================================================================
    // MODULE: AI REPHRASING ENGINE
    // =================================================================
    // IMPLEMENTATION: Rephrasing engine refined with stronger vocabulary and word replacement.
    function enhancedRephraseNarrative() {
        if (state.selectedPhraseTexts.length === 0) {
            showError("Please select at least one intervention to rephrase.");
            return;
        }

        DOMElements.rephraseBtn.textContent = '🤔 Analyzing...';
        DOMElements.rephraseBtn.disabled = true;

        setTimeout(() => {
            const data = {
                interventionText: state.selectedPhraseTexts.join(', '),
                goalText: state.selectedGoalText || '',
                reasoningText: state.selectedReasoningText || '',
                assistanceLevels: [],
                difficultyReasons: state.selectedDifficultyReasons,
                response: state.selectedResponse || '',
                outcome: state.selectedOutcome || '',
                plan: state.selectedPlan || '',
                params: state.sessionParams || {}
            };
            
            state.usedAssistanceIds.forEach(assistId => {
                 const assistType = clinicalData.assistanceLevels.find(a => a.id === assistId);
                 if (assistType) {
                     const level = assistType.levels.find(l => l.id === state.selectedAssistanceLevelId);
                     if (level) {
                         let text = level.text;
                         if (state.selectedAssistanceId === assistId && state.selectedJustification) {
                            text += ` ${state.selectedJustification}`;
                         }
                         if (!data.assistanceLevels.includes(text)) data.assistanceLevels.push(text);
                     }
                 }
            });
            const assistanceText = data.assistanceLevels.join(' and ');
            const paramsText = Object.entries(data.params).map(([key, values]) => `${values.join(', ')} ${clinicalData.sessionParameters[key].name}`).join('; ');

            const strongVerbs = ['facilitated in', 'instructed in', 'trained in', 'guided through'];
            const randomVerb = strongVerbs[Math.floor(Math.random() * strongVerbs.length)];

            const templates = [
                () => `To ${data.reasoningText.replace(/^to /i, '')}, patient ${randomVerb} ${data.interventionText}${paramsText ? ` for ${paramsText}`: ''}.`,
                () => `Patient ${randomVerb} ${data.interventionText} to address the goal of "${data.goalText}".`,
                () => `To promote ${data.reasoningText.replace(/^to /i, '').split(' ')[0]}, ${data.interventionText} was performed.`
            ];
            
            let narrative = templates[Math.floor(Math.random() * templates.length)]();
            if (assistanceText) narrative = appendToNarrative(narrative, `Patient required ${assistanceText}.`);
            if (data.difficultyReasons.length > 0) narrative = appendToNarrative(narrative, `Performance was limited ${data.difficultyReasons.join(' and ')}.`);
            if (data.response) narrative = appendToNarrative(narrative, `${data.response}.`);
            if (data.outcome) narrative = appendToNarrative(narrative, `${data.outcome}.`);
            if (data.plan) narrative = appendToNarrative(narrative, `Plan: ${data.plan}.`);

            narrative = narrative.replace(/helped/gi, 'provided assistance for').replace(/\.\./g, '.').replace(/ \./g, '.').trim();
            updateState({ currentNarrative: narrative });

            if (DOMElements.rephraseBtn) {
                DOMElements.rephraseBtn.textContent = '✨ Rephrase Note';
                DOMElements.rephraseBtn.disabled = false;
            }
        }, 750);
    }

    // =================================================================
    // MODULE: RENDERING ENGINE
    // =================================================================
    function renderBuilder() {
        const modal = document.createElement('div'); modal.className = 'builder-modal-overlay';
        modal.innerHTML = `<div class="builder-modal"><div class="builder-header"><h1>Clinical Note Builder</h1><div class="timer">${formatTime(sessionTime)}</div></div><div class="progress-container"><div class="progress-indicator"><div class="progress-bar"></div></div></div><div class="builder-body"><div class="narrative-panel"><div class="narrative-header"><h2>Generated Narrative</h2><div class="actions"><button class="rephrase-btn" data-action="rephrase-note">✨ Rephrase Note</button><button data-action="add-new-sentence">New Sentence</button></div></div><div class="narrative-content"><div class="narrative-box" contenteditable="true" data-action="edit-narrative">${sanitizeForHTML(state.currentNarrative)}</div></div></div><div class="steps-panel"><div class="steps-header"><h3>Step <span id="current-step-display"></span> of ${CONSTANTS.MAX_PROGRESS_STEPS}</h3></div><div class="steps-content"></div></div></div><div class="builder-footer"><button class="back-btn" data-action="go-back">Back</button><div><button class="cancel-btn" data-action="close-builder">Cancel</button><button class="finalize-btn" data-action="finalize-note">Finalize Note</button></div></div></div>`;
        document.body.appendChild(modal);
        cacheDOMElements();
        updateBuilderView();
    }
    
    // IMPLEMENTATION: Added "Save All Notes" button to main page render.
    function renderMainPage() {
        root.innerHTML = `<div class="main-page"><header class="header"><h1>OT Clinical Documentation Builder</h1><p>Streamline your clinical documentation.</p><div class="main-page-actions"><button class="save-all-notes-btn" data-action="save-all-notes">💾 Save All Notes</button>${localStorage.getItem(CONSTANTS.LOCAL_STORAGE_KEY) ? `<button class="cancel-btn" data-action="clear-saved-state">Clear Saved Session</button>` : ''}</div></header><div class="cards-grid"><div class="card"><div class="card-header"><h2>Skilled Intervention: 97535 Self Care</h2><button class="build-note-btn" data-action="open-builder" data-cpt="97535">Build Note...</button></div><div class="note-container"><label for="selfCareNote">Clinical Note</label><textarea id="selfCareNote"></textarea><button class="copy-btn" data-action="copy" data-target="selfCareNote" title="Copy" style="display:none;">📋</button></div></div><div class="card"><div class="card-header"><h2>Skilled Intervention: 97530 Therapeutic Activities</h2><button class="build-note-btn" data-action="open-builder" data-cpt="97530">Build Note...</button></div><div class="note-container"><label for="therapeuticNote">Clinical Note</label><textarea id="therapeuticNote"></textarea><button class="copy-btn" data-action="copy" data-target="therapeuticNote" title="Copy" style="display:none;">📋</button></div></div></div></div>`;
        const selfCareEl = document.getElementById('selfCareNote'), theraEl = document.getElementById('therapeuticNote');
        if (selfCareEl) { selfCareEl.value = notes.selfCare; if(notes.selfCare) selfCareEl.nextElementSibling.style.display='block'; }
        if (theraEl) { theraEl.value = notes.therapeutic; if(notes.therapeutic) theraEl.nextElementSibling.style.display='block'; }
    }

    function renderStep1() {
        const type = state.selectedCPTCode === CONSTANTS.CPT_SELF_CARE ? 'self-care' : 'therapeutic';
        const categories = clinicalData.interventionData[type];
        const buttons = Object.entries(categories).map(([key, category]) => `<button class="option-button" data-action="select-category" data-id="${key}" data-context="${sanitizeForAttribute(category.context || key)}" data-next-step="${type === 'therapeutic' ? 2 : 3}">${sanitizeForHTML(category.name)}</button>`).join('');
        return `<div><h3>Select Intervention Category</h3><div class="option-grid">${buttons}</div></div>`;
    }

    function renderStep2() {
        const category = getCurrentInterventionContext();
        if (!category || !category.subInterventions) return '<div>Error: Sub-categories not found.</div>';
        const buttons = Object.entries(category.subInterventions).map(([key, sub]) => `<button class="option-button" data-action="select-sub-category" data-id="${key}" data-context="${sanitizeForAttribute(sub.context)}">${sanitizeForHTML(sub.name)}</button>`).join('');
        return `<div><h3>Select Sub-Category</h3><div class="option-grid">${buttons}</div></div>`;
    }

    function renderStep3() {
        const intervention = getCurrentInterventionContext();
        if (!intervention || !intervention.phrases) return '<div>Error: Phrases not found.</div>';
        const buttons = intervention.phrases.map(p => `<button class="option-button ${state.selectedPhraseTexts.includes(p) ? 'selected' : ''}" data-action="select-phrase" data-phrase="${sanitizeForAttribute(p)}">${sanitizeForHTML(p)}</button>`).join('');
        const customPhrases = state.selectedPhraseTexts.filter(p => !intervention.phrases.includes(p));
        const customButtons = customPhrases.map(p => `<button class="option-button selected" data-action="select-phrase" data-phrase="${sanitizeForAttribute(p)}">${sanitizeForHTML(p)}</button>`).join('');
        const nextButton = state.selectedPhraseTexts.length > 0 ? `<div class="step-footer"><button class="next-btn" data-action="confirm-interventions">Next</button></div>` : '';
        const customInputHTML = `<div class="custom-phrase-container" style="margin-top: 1rem; border-top: 1px solid #e5e7eb; padding-top: 1rem;"><button class="option-button" data-action="toggle-custom-phrase-input" style="background-color: #f0f9ff; border-color: #7dd3fc;">Add Custom Phrase</button><div id="custom-phrase-input-wrapper" style="display:${state.showCustomPhraseInput ? 'flex' : 'none'}; gap: 0.5rem; margin-top: 0.5rem;"><input type="text" id="custom-phrase-input" placeholder="Enter custom phrase..." style="flex-grow:1; padding: 0.4rem; border: 1px solid #d1d5db; border-radius: 0.375rem;"><button class="add-btn" data-action="save-custom-phrase" style="padding: 0.4rem 0.8rem; font-size: 0.875rem;">Add</button></div></div>`;
        return `<div><h3>Select Intervention Phrase(s)</h3><div class="option-grid">${buttons}${customButtons}</div>${customInputHTML}${nextButton}</div>`;
    }

    function renderStep4() {
        const goals = [...(clinicalData.clinicalReasoning.contextual[state.selectedContext] || []), ...clinicalData.clinicalReasoning.general];
        const buttons = goals.map(r => `<button class="option-button" data-action="select-reasoning" data-reasoning="${sanitizeForAttribute(r)}">${sanitizeForHTML(r)}</button>`).join('');
        return `<div><h3>Select Clinical Rationale</h3><div class="option-grid" style="grid-template-columns: 1fr;">${buttons}</div></div>`;
    }

    function renderStep5() {
        if (!clinicalData.patientGoals) return '<div>Error: Patient goals not found. Please update clinicalData.json.</div>';
        const buttons = clinicalData.patientGoals.map(g => `<button class="option-button" data-action="select-goal" data-goal="${sanitizeForAttribute(g)}">${sanitizeForHTML(g)}</button>`).join('');
        return `<div><h3>Link to Patient Goal</h3><div class="option-grid" style="grid-template-columns: 1fr;">${buttons}</div></div>`;
    }

    function renderStep6() {
        const buttons = clinicalData.assistanceLevels.map(a => `<button class="option-button" data-action="select-assistance-type" data-id="${a.id}" ${state.usedAssistanceIds.includes(a.id) ? 'disabled' : ''}>${sanitizeForHTML(a.name)}</button>`).join('');
        return `<div><h3>Select Assistance Provided (Optional)</h3><p style="font-size: 0.875rem; color: #94a3b8;">Add all needed assistance types, then click 'Continue'.</p><div class="option-grid">${buttons}</div><div class="step-footer"><button class="skip-btn" data-action="skip-assistance">Continue</button></div></div>`;
    }
    
    function renderStep7() {
        const buttons = Object.entries(clinicalData.difficultyReasons).map(([key, group]) => `<div class="option-group"><h4>${group.name}</h4>${group.options.map(opt => `<button class="option-button ${state.selectedDifficultyReasons.includes(opt) ? 'selected' : ''}" data-action="select-difficulty" data-reason="${sanitizeForAttribute(opt)}">${sanitizeForHTML(opt)}</button>`).join('')}</div>`).join('');
        return `<div><h3>Why was it difficult? (Optional)</h3><div class="option-grid">${buttons}</div><div class="step-footer"><button class="next-btn" data-action="add-difficulty">Next</button></div></div>`;
    }
    
    function renderStep8() {
        const renderTab = (tabKey) => {
            const sourceMap = { response: 'responseOptions', outcome: 'outcomeOptions', plan: 'sessionPlans'};
            const source = clinicalData[sourceMap[tabKey]];
            const action = `select-${tabKey}`;
            const dataKey = tabKey;
            return Object.values(source).map(group => `<div class="option-group"><h4>${group.name}</h4>${group.options.map(opt => `<button class="option-button" data-action="${action}" data-${dataKey}="${sanitizeForAttribute(opt)}">${sanitizeForHTML(opt)}</button>`).join('')}</div>`).join('');
        }
        return `<div class="tab-container"><div class="tab-header">${['response', 'outcome', 'plan'].map(t => `<button class="tab-button ${state.activeTab === t ? 'active' : ''}" data-action="switch-tab" data-tab="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</button>`).join('')}</div><div class="tab-content">${renderTab(state.activeTab)}</div></div>`;
    }

    // IMPLEMENTATION: Assistance modal now includes a "Back" button for justification step.
    function renderAssistanceModal() {
        const assistType = clinicalData.assistanceLevels.find(a => a.id === state.selectedAssistanceId);
        if (!assistType) { showError("Error finding assistance data."); return; }
        let body = '', footer = '';
        if (state.assistanceModalStep === 'level') {
            body = assistType.levels.map(l => `<button class="option-button assistance-option" data-action="select-assistance-level" data-id="${l.id}"><div class="option-text">${l.text}</div><div class="option-description">${l.description}</div></button>`).join('');
            footer = `<button class="cancel-modal-btn" data-action="close-assistance-modal">Cancel</button>`;
        } else { // Justification step
            const justOptions = clinicalData.assistanceJustifications[state.selectedAssistanceId];
            body = justOptions.options.map(opt => `<button class="option-button ${state.selectedJustification === opt ? 'selected' : ''}" data-action="select-justification" data-justification="${sanitizeForAttribute(opt)}">${sanitizeForHTML(opt)}</button>`).join('');
            footer = `<button class="back-modal-btn" data-action="back-in-modal">Back</button><div><button class="add-no-justify-btn" data-action="add-no-justify">Add Without</button><button class="add-btn" data-action="add-with-justification" ${!state.selectedJustification ? 'disabled' : ''}>Add with Justification</button></div>`;
        }
        const modal = document.createElement('div'); modal.className = 'modal-overlay';
        modal.innerHTML = `<div class="modal"><div class="modal-header"><h3>${state.assistanceModalStep === 'level' ? 'Select Level' : 'Select Justification'}</h3></div><div class="modal-body">${body}</div><div class="modal-footer" style="justify-content: space-between;">${footer}</div></div>`;
        document.body.appendChild(modal);
    }

    function renderParametersModal() {
        if (!clinicalData.sessionParameters) { console.error("sessionParameters not found"); return; }
        const params = clinicalData.sessionParameters;
        let body = '';
        for (const [key, group] of Object.entries(params)) {
            body += `<div class="param-group"><h4>${sanitizeForHTML(group.name)}</h4><div class="param-options-grid">`;
            body += group.options.map(opt => `<label class="param-label" for="param-${key}-${opt}"><input type="checkbox" name="${key}" value="${sanitizeForAttribute(opt)}" id="param-${key}-${opt}">${sanitizeForHTML(opt)}</label>`).join('');
            body += `</div></div>`;
        }
        const modal = document.createElement('div'); modal.className = 'modal-overlay parameters-modal-overlay';
        modal.innerHTML = `<div class="modal"><div class="modal-header"><h3>Add Session Details (Optional)</h3><button type="button" class="modal-close-btn" data-action="close-parameters-modal" title="Close" style="position: absolute; top: 1rem; right: 1.5rem; background: none; border: none; font-size: 1.5rem; cursor: pointer; line-height: 1;">&times;</button></div><form data-action="save-parameters"><div class="modal-body">${body}</div><div class="modal-footer"><button type="button" class="skip-btn" data-action="close-parameters-modal">Skip</button><button type="submit" class="add-btn">Add Details</button></div></form></div>`;
        document.body.appendChild(modal);
    }
    
    function cacheDOMElements() {
        const builderModal = document.querySelector('.builder-modal-overlay');
        if (builderModal) {
            DOMElements.rephraseBtn = builderModal.querySelector('[data-action="rephrase-note"]');
        }
    }
    
    function updateBuilderView() {
        const builderModal = document.querySelector('.builder-modal-overlay');
        if (!builderModal) return;
        cacheDOMElements();
        const stepsContent = builderModal.querySelector('.steps-content');
        const step = state.currentStep;
        builderModal.querySelector('#current-step-display').textContent = step;
        const stepRenderers = [renderStep1, renderStep2, renderStep3, renderStep4, renderStep5, renderStep6, renderStep7, renderStep8, renderStep8, renderStep8, renderStep8];
        stepsContent.innerHTML = stepRenderers[step - 1] ? stepRenderers[step - 1]() : `<div>End of note.</div>`;
        const narrativeBox = builderModal.querySelector('.narrative-box');
        if (narrativeBox && document.activeElement !== narrativeBox && narrativeBox.innerHTML !== state.currentNarrative) {
            narrativeBox.innerHTML = sanitizeForHTML(state.currentNarrative);
        }
        const progressBar = builderModal.querySelector('.progress-bar');
        if (progressBar) { progressBar.style.width = `${Math.min((step / CONSTANTS.MAX_PROGRESS_STEPS) * 100, 100)}%`; }
        const backBtn = builderModal.querySelector('.builder-footer .back-btn');
        if (backBtn) backBtn.disabled = state.history.length === 0;
    }

    function render() {
        const builderModal = document.querySelector('.builder-modal-overlay');
        const assistanceModal = document.querySelector('.modal-overlay:not(.parameters-modal-overlay)');
        const parametersModal = document.querySelector('.parameters-modal-overlay');
        
        if (!builderModal && !state.selectedCPTCode) renderMainPage();
        else if (builderModal && !state.selectedCPTCode) { builderModal.remove(); renderMainPage(); }
        else if (!builderModal && state.selectedCPTCode) renderBuilder();
        else if (builderModal && state.selectedCPTCode) updateBuilderView();

        // New, corrected code
if (assistanceModal) {
    assistanceModal.remove(); // Always remove the old modal if it exists
}
if (state.showAssistanceModal) {
    renderAssistanceModal(); // Render a new modal if the state requires it
}
        
        if (parametersModal && !state.showParametersModal) parametersModal.remove();
        if (!parametersModal && state.showParametersModal) renderParametersModal();
    }

    // =================================================================
    // MODULE: ACTION HANDLERS
    // =================================================================
    const actionHandlers = {
        'open-builder': (data) => { updateState({ ...initialState, selectedCPTCode: data.cpt, sessionTime: 0 }, { addToHistory: false }); startTimer(); },
        'close-builder': (data, e) => { if (state.currentNarrative && e.type === 'click' && !confirm("Are you sure? Your work will be lost.")) return; stopTimer(); updateState({ selectedCPTCode: null, history: [] }, { addToHistory: false, save: true }); },
        'finalize-note': () => {
            const narrativeBox = document.querySelector('.narrative-box');
            let finalNarrative = (narrativeBox.innerText || narrativeBox.textContent).trim();
            if (finalNarrative && !/[.!?]$/.test(finalNarrative)) finalNarrative += '.';
            const noteType = state.selectedCPTCode === CONSTANTS.CPT_SELF_CARE ? 'selfCare' : 'therapeutic';
            notes[noteType] = (notes[noteType] ? notes[noteType] + ' ' : '') + finalNarrative;
            actionHandlers['close-builder'](null, { type: 'system' });
        },
        'copy': (data) => navigator.clipboard.writeText(document.getElementById(data.target).value).then(() => showError("Copied!", 1500)),
        'edit-narrative': (data, e) => { state.currentNarrative = e.target.innerText || e.target.textContent; saveStateToLocalStorage(); },
        'clear-saved-state': () => { if (confirm("Clear entire saved session?")) { localStorage.removeItem(CONSTANTS.LOCAL_STORAGE_KEY); notes = { selfCare: '', therapeutic: '' }; updateState(initialState, { addToHistory: false, save: false }); } },
        'go-back': undoState,
        'rephrase-note': () => enhancedRephraseNarrative(),
        // IMPLEMENTATION: Handler for the new Save All Notes button.
        'save-all-notes': () => {
            const selfCareNote = document.getElementById('selfCareNote').value;
            const therapeuticNote = document.getElementById('therapeuticNote').value;
            notes.selfCare = selfCareNote;
            notes.therapeutic = therapeuticNote;
            saveStateToLocalStorage();
            showError("Notes Saved!", 1500);
        },
        'select-category': (data) => updateState({ currentStep: parseInt(data.nextStep, 10), selectedCategoryId: data.id, selectedContext: data.context }),
        'select-sub-category': (data) => updateState({ currentStep: 3, selectedSubCategoryId: data.id, selectedContext: data.context }),
        'select-phrase': (data) => {
            const phrase = data.phrase;
            const currentPhrases = state.selectedPhraseTexts;
            let newPhrases = currentPhrases.includes(phrase) ? currentPhrases.filter(p => p !== phrase) : [...currentPhrases, phrase];
            updateState({ selectedPhraseTexts: newPhrases }, { addToHistory: false });
        },
        'toggle-custom-phrase-input': () => updateState({ showCustomPhraseInput: !state.showCustomPhraseInput }, {addToHistory: false}),
        'save-custom-phrase': () => {
            const input = document.getElementById('custom-phrase-input');
            if (input && input.value.trim()) {
                const newPhrase = input.value.trim();
                if (!state.selectedPhraseTexts.includes(newPhrase)) {
                    updateState({ selectedPhraseTexts: [...state.selectedPhraseTexts, newPhrase], showCustomPhraseInput: false }, {addToHistory: false});
                }
            }
        },
        'confirm-interventions': () => {
            if (state.selectedPhraseTexts.length === 0) return;
            const phrases = state.selectedPhraseTexts.map(p => p.charAt(0).toLowerCase() + p.slice(1));
            let phraseString = phrases.length === 1 ? phrases[0] : (phrases.slice(0, -1).join(', ') + ' and ' + phrases.slice(-1));
            const newNarrative = `Patient engaged in ${phraseString}.`;
            updateState({ currentNarrative: state.isNewSentence ? newNarrative : appendToNarrative(state.currentNarrative, newNarrative), showParametersModal: true, isNewSentence: false });
        },
        'close-parameters-modal': () => updateState({ showParametersModal: false, currentStep: 4 }),
        'save-parameters': (data, e) => {
            const form = e.target.closest('form');
            const formData = new FormData(form);
            const details = {};
            for (const key of formData.keys()) { details[key] = formData.getAll(key); }
            const detailsString = Object.entries(details).map(([key, values]) => `${values.join(', ')} ${clinicalData.sessionParameters[key].name}`).join('; ');
            let newNarrative = state.currentNarrative;
            if (detailsString) {
                let baseNarrative = state.currentNarrative.trim();
                if (baseNarrative.endsWith('.')) baseNarrative = baseNarrative.slice(0, -1);
                newNarrative = `${baseNarrative} for ${detailsString}.`;
            }
            updateState({ currentStep: 4, showParametersModal: false, sessionParams: details, currentNarrative: newNarrative });
        },
        'select-reasoning': (data) => {
            const narrative = appendToNarrative(state.currentNarrative, `Intervention was provided ${data.reasoning}.`);
            updateState({ currentStep: 5, selectedReasoningText: data.reasoning, currentNarrative: narrative });
        },
        'select-goal': (data) => {
            const narrative = appendToNarrative(state.currentNarrative, `This addresses the patient goal of "${data.goal}".`);
            updateState({ currentStep: 6, selectedGoalText: data.goal, currentNarrative: narrative });
        },
        'select-assistance-type': (data) => updateState({ showAssistanceModal: true, assistanceModalStep: 'level', selectedAssistanceId: data.id, selectedJustification: null }),
        'close-assistance-modal': () => updateState({ showAssistanceModal: false }),
        'select-assistance-level': (data) => {
            state.selectedAssistanceLevelId = data.id; // Set directly to prevent race conditions
            if (clinicalData.assistanceJustifications[state.selectedAssistanceId]) {
                updateState({ assistanceModalStep: 'justification' }, {addToHistory: false});
            } else {
                actionHandlers['add-no-justify']();
            }
        },
        'select-justification': (data) => updateState({ selectedJustification: data.justification }, {addToHistory: false}),
        // IMPLEMENTATION: Handler for the new "Back" button inside the modal.
        'back-in-modal': () => {
            updateState({ assistanceModalStep: 'level', selectedJustification: null }, { addToHistory: false });
        },
        'add-with-justification': () => {
            if (!state.selectedJustification) return;
            const assistType = clinicalData.assistanceLevels.find(a => a.id === state.selectedAssistanceId);
            const level = assistType.levels.find(l => l.id === state.selectedAssistanceLevelId);
            const narrative = appendToNarrative(state.currentNarrative, `Patient required ${level.text} ${state.selectedJustification}.`);
            updateState({ currentNarrative: narrative, showAssistanceModal: false, usedAssistanceIds: [...state.usedAssistanceIds, state.selectedAssistanceId], currentStep: 6 });
        },
        'add-no-justify': () => {
            const assistType = clinicalData.assistanceLevels.find(a => a.id === state.selectedAssistanceId);
            const level = assistType.levels.find(l => l.id === state.selectedAssistanceLevelId);
            const narrative = appendToNarrative(state.currentNarrative, `Patient required ${level.text}.`);
            updateState({ currentNarrative: narrative, showAssistanceModal: false, usedAssistanceIds: [...state.usedAssistanceIds, state.selectedAssistanceId], currentStep: 6 });
        },
        'skip-assistance': () => updateState({ currentStep: 7 }),
        'select-difficulty': (data) => {
            const reason = data.reason;
            const newReasons = state.selectedDifficultyReasons.includes(reason) ? state.selectedDifficultyReasons.filter(r => r !== reason) : [...state.selectedDifficultyReasons, reason];
            updateState({ selectedDifficultyReasons: newReasons }, {addToHistory: false});
        },
        'add-difficulty': () => {
            const narrative = state.selectedDifficultyReasons.length > 0 ? appendToNarrative(state.currentNarrative, `Performance was limited ${state.selectedDifficultyReasons.join(' and ')}.`) : state.currentNarrative;
            updateState({ currentStep: 8, activeTab: 'response', currentNarrative: narrative });
        },
        'switch-tab': (data) => updateState({ activeTab: data.tab }, {addToHistory: false}),
        'select-response': (data) => {
            updateState({ currentStep: 9, activeTab: 'outcome', selectedResponse: data.response, currentNarrative: appendToNarrative(state.currentNarrative, `${data.response}.`) });
        },
        'select-outcome': (data) => {
            updateState({ currentStep: 10, activeTab: 'plan', selectedOutcome: data.outcome, currentNarrative: appendToNarrative(state.currentNarrative, `${data.outcome}.`) });
        },
        'select-plan': (data) => {
            updateState({ currentStep: 11, selectedPlan: data.plan, currentNarrative: appendToNarrative(state.currentNarrative, `Plan: ${data.plan}.`) });
        },
        // IMPLEMENTATION: Timer now resets when adding a new sentence.
        'add-new-sentence': () => {
            const noteType = state.selectedCPTCode === CONSTANTS.CPT_SELF_CARE ? 'selfCare' : 'therapeutic';
            notes[noteType] = appendToNarrative(notes[noteType], state.currentNarrative);
            const CPT = state.selectedCPTCode;
            const savedNote = notes[noteType];
            updateState({ ...initialState, selectedCPTCode: CPT, sessionTime: 0 }, {addToHistory: false});
            notes[noteType] = savedNote;
            sessionTime = 0; // Reset timer
            startTimer(); // Restart timer
        }
    };

    // =================================================================
    // MODULE: INITIALIZATION & EVENT LISTENERS
    // =================================================================
    function initialize() {
        document.addEventListener('click', (e) => {
            const actionTarget = e.target.closest('[data-action]');
            if (actionTarget) {
                const { action, ...data } = actionTarget.dataset;
                if (actionHandlers[action] && action !== 'save-parameters') {
                    e.preventDefault();
                    try { actionHandlers[action](data, e); }
                    catch (err) { console.error(`Action "${action}" failed:`, err); showError("An unexpected error occurred."); }
                }
            }
            if (e.target.matches('.param-label input[type="checkbox"]')) {
                e.target.parentElement.classList.toggle('selected', e.target.checked);
            }
        });

        document.addEventListener('submit', (e) => {
            if (e.target.closest('[data-action="save-parameters"]')) {
                e.preventDefault();
                try { actionHandlers['save-parameters'](e.target.dataset, e); } 
                catch (err) { console.error(`Action "save-parameters" failed:`, err); showError("An unexpected error occurred."); }
            }
        });

        document.addEventListener('input', (e) => {
            if (e.target.closest('[data-action="edit-narrative"]')) {
                actionHandlers['edit-narrative'](null, e);
            }
        });

        window.addEventListener('beforeunload', (e) => {
            if (state.selectedCPTCode) {
                e.preventDefault(); e.returnValue = '';
            }
        });

        if (!loadStateFromLocalStorage()) {
            updateState(initialState, { addToHistory: false, save: false });
        } else {
            render();
            if (state.selectedCPTCode) startTimer();
        }
    }

    initialize();
});