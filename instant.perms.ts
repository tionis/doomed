export default {
  $users: {
    allow: {
      view: "auth.id == data.id || isAdmin",
      create: "true",
      update: "false",
      delete: "false",
    },
    fields: {
      email: "auth.id == data.id || isAdmin",
    },
    bind: {
      isAdmin: "auth.id != null && auth.ref('$user.adminRecords.id') != []",
    },
  },
  admins: {
    allow: {
      view: "isAdmin || isSelfAdminRecord",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: {
      isAdmin: "auth.id != null && auth.ref('$user.adminRecords.id') != []",
      isSelfAdminRecord: "auth.id != null && auth.id in data.ref('user.id')",
    },
  },
  rooms: {
    allow: {
      view: "true",
      create: "isAdmin || (onlyModifiesPublicRoomFields && hostUserValid && hostEmailValid)",
      update: "isAdmin || (onlyModifiesPublicRoomFields && hostUserValid && hostEmailValid)",
      delete: "isAdmin",
    },
    bind: {
      isAdmin: "auth.id != null && auth.ref('$user.adminRecords.id') != []",
      onlyModifiesPublicRoomFields:
        "request.modifiedFields.all(field, field in ['code', 'hostClientId', 'hostUserId', 'hostEmail', 'hostName', 'activePlayerId', 'status', 'roundIndex', 'roundCount', 'submissionSeconds', 'difficulty', 'revealIndex', 'scenarioTitle', 'scenarioText', 'immediateThreat', 'timePressure', 'category', 'bannedWords', 'deadlineAt', 'hiddenFromHostHistory', 'finishedAt', 'createdAt', 'updatedAt'])",
      hostUserValid:
        "!('hostUserId' in request.modifiedFields) || (auth.id != null && newData.hostUserId == auth.id)",
      hostEmailValid:
        "!('hostEmail' in request.modifiedFields) || (auth.email != null && newData.hostEmail == auth.email)",
    },
  },
  players: {
    allow: {
      view: "true",
      create: "true",
      update: "true",
      delete: "isAdmin",
    },
    bind: {
      isAdmin: "auth.id != null && auth.ref('$user.adminRecords.id') != []",
    },
  },
  submissions: {
    allow: {
      view: "true",
      create: "true",
      update: "true",
      delete: "isAdmin",
    },
    bind: {
      isAdmin: "auth.id != null && auth.ref('$user.adminRecords.id') != []",
    },
  },
  judgments: {
    allow: {
      view: "true",
      create: "true",
      update: "true",
      delete: "isAdmin",
    },
    bind: {
      isAdmin: "auth.id != null && auth.ref('$user.adminRecords.id') != []",
    },
  },
};
