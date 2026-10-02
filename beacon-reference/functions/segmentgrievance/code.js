(function () {
    const enabledAgents = JSON.parse(
        localStorage.getItem('enabledAgents') || '[]'
    );
        return enabledAgents
        .map(agent => String(agent).toLowerCase())
        .includes('grievance'.toLowerCase());
})