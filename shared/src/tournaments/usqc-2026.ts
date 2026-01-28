import type { TournamentConfig, TournamentListEntry } from '../types'

export const USQC_2026_TOURNAMENT: TournamentListEntry = {
  "id": "usqc-2026",
  "name": "US Quadball Cup 2026",
  "year": 2026,
  "published": true
}

export const USQC_2026_CONFIG: TournamentConfig = {
  "id": "usqc-2026",
  "name": "US Quadball Cup 2026",
  "year": 2026,
  "branding": {
    "tournamentLogoKey": "config/tournaments/usqc-2026/logos/tournament.png",
    "orgLogoKey": "config/tournaments/usqc-2026/logos/org.png",
    "primaryColor": "#1b4278",
    "eventIndicator": "USQC26"
  },
  "teams": [
    {
      "id": "texas-state",
      "name": "Texas State Quadball",
      "logoKey": "config/tournaments/usqc-2025/teams/texas-state.png"
    },
    {
      "id": "usa-quadball",
      "name": "USA Quadball",
      "logoKey": "config/tournaments/usqc-2025/teams/usa-quadball.png"
    },
    {
      "id": "boston-red-pandas",
      "name": "Boston Red Pandas",
      "logoKey": "config/tournaments/usqc-2025/teams/boston-red-pandas.png"
    },
    {
      "id": "boston-university",
      "name": "Boston University Quadball",
      "logoKey": "config/tournaments/usqc-2025/teams/boston-university.png"
    },
    {
      "id": "bay-area-breakers",
      "name": "Bay Area Breakers",
      "logoKey": "config/tournaments/usqc-2025/teams/bay-area-breakers.png"
    },
    {
      "id": "chicago-united",
      "name": "Chicago United",
      "logoKey": "config/tournaments/usqc-2025/teams/chicago-united.png"
    },
    {
      "id": "new-york-titans",
      "name": "New York Titans",
      "logoKey": "config/tournaments/usqc-2025/teams/new-york-titans.png"
    },
    {
      "id": "indy-intensity",
      "name": "Indy Intensity",
      "logoKey": "config/tournaments/usqc-2025/teams/indy-intensity.png"
    },
    {
      "id": "lone-star-qc",
      "name": "Lone Star QC",
      "logoKey": "config/tournaments/usqc-2025/teams/lone-star-qc.png"
    },
    {
      "id": "lost-boys",
      "name": "Lost Boys",
      "logoKey": "config/tournaments/usqc-2025/teams/lost-boys.png"
    },
    {
      "id": "silicon-valley-vipers",
      "name": "Silicon Valley Vipers",
      "logoKey": "config/tournaments/usqc-2025/teams/silicon-valley-vipers.png"
    },
    {
      "id": "washington-admirals",
      "name": "Washington Admirals",
      "logoKey": "config/tournaments/usqc-2025/teams/washington-admirals.png"
    }
  ],
  "cardTypes": [
    {
      "type": "player",
      "enabled": true,
      "label": "Player",
      "showTeamField": true,
      "showJerseyNumber": true,
      "positions": [
        "Beater",
        "Chaser",
        "Keeper",
        "Seeker",
        "Utility"
      ]
    },
    {
      "type": "national-team",
      "enabled": true,
      "label": "National Team",
      "showTeamField": true,
      "showJerseyNumber": true,
      "positions": [
        "Beater",
        "Chaser",
        "Keeper",
        "Seeker",
        "Utility"
      ]
    },
    {
      "type": "team-staff",
      "enabled": true,
      "label": "Team Staff",
      "showTeamField": true,
      "showJerseyNumber": true,
      "positions": [
        "Captain",
        "Coach",
        "Manager",
        "Mascot",
        "Staff"
      ]
    },
    {
      "type": "media",
      "enabled": true,
      "label": "Media",
      "showTeamField": false,
      "showJerseyNumber": false,
      "logoOverrideKey": "config/tournaments/usqc-2026/logos/org.png",
      "positions": [
        "Commentator",
        "Livestream",
        "Photographer",
        "Videographer",
        "Media"
      ]
    },
    {
      "type": "official",
      "enabled": true,
      "label": "Official",
      "showTeamField": false,
      "showJerseyNumber": false,
      "logoOverrideKey": "config/tournaments/usqc-2026/logos/org.png",
      "positions": [
        "Flag Runner",
        "Head Referee",
        "Referee"
      ]
    },
    {
      "type": "tournament-staff",
      "enabled": true,
      "label": "Tournament Staff",
      "showTeamField": false,
      "showJerseyNumber": false,
      "logoOverrideKey": "config/tournaments/usqc-2026/logos/tournament.png",
      "positions": [
        "Gameplay",
        "Tournament Staff",
        "Volunteer"
      ]
    },
    {
      "type": "rare",
      "enabled": true,
      "label": "Rare Card",
      "showTeamField": false,
      "showJerseyNumber": false,
      "logoOverrideKey": "config/tournaments/usqc-2026/logos/tournament.png",
      "positions": []
    },
    {
      "type": "super-rare",
      "enabled": false,
      "label": "Super Rare Card",
      "showTeamField": false,
      "showJerseyNumber": true,
      "positions": [
        "Beater",
        "Chaser",
        "Keeper",
        "Seeker",
        "Utility"
      ]
    }
  ],
  "templates": [
    {
      "id": "usqc26",
      "label": "USQC26"
    }
  ],
  "defaultTemplates": {
    "fallback": "usqc26"
  },
  "createdAt": "2026-01-10T00:00:00.000Z",
  "updatedAt": "2026-01-10T00:00:00.000Z"
}
