'use strict';
const BootBot = require('bootbot');
const config = require('config');
const Promise = require('bluebird');

const VENUES_KEY = "venues";
const PAGE_KEY = "page";
const COORDS_KEY = "coords";
const TYPE_KEY = "venue_type";

const googleMapsApiKey = config.get("GOOGLE_MAPS_API_KEY");

const foursquare = require('foursquarevenues');
const venues = foursquare(config.get('FOURSQUARE_ID'), config.get('FOURSQUARE_SECRET'));
const beerCategoryID = "50327c8591d4c4b30a586d5d";
const burgerCategoryID = "4bf58dd8d48988d16c941735";
const radius = 15000; // 15km

const pageSize = 5;

const bot = new BootBot({
  accessToken: config.get('ACCESS_TOKEN'),
  verifyToken: config.get('VERIFY_TOKEN'),
  appSecret: config.get('APP_SECRET')
});

bot.sendProfileRequest({
  whitelisted_domains: [
    "https://foursquare.com"
  ]
});

const staticMapsURL = coords => {
  const coordStr = `${coords.lat},${coords.lng}`;
  return `https://maps.googleapis.com/maps/api/staticmap?center=${coordStr}&zoom=13&size=600x300&maptype=roadmap&markers=color:blue:A%7C${coordStr}`;
};

const venueSearch = (categories, coords) => {
  const params = {
    ll: `${coords.lat},${coords.lng}`,
    categoryId: categories.join(","),
    radius: radius,
    intent: "browse",
    limit: 50
  };
  return new Promise((res, rej) => {
    venues.getVenues(params, (error, response) => {
      if (error) { return rej(error) }
      res(response.response.venues);
    });
  });
}

const findVenues = (type, coords) => {
  switch (type) {
    case "burgers":
      return venueSearch([burgerCategoryID], coords);
    case "beer":
      return venueSearch([beerCategoryID], coords);
    default:
      return venueSearch([burgerCategoryID, beerCategoryID], coords);
  }
}


bot.hear(["hi", "hello"], (payload, chat) => {
  chat.say("Hi there").then(res => {
    chat.conversation(burgerSearchConvo);
  });
});

const burgerSearchConvo = (convo) => {
  convo.ask({
    text: "Can you give me your location so I can find the closest burger places?",
    quickReplies: [{content_type: "location"}]
  }, askVenueType);
};

const askVenueType = (payload, convo) => {
  saveLocation(payload, convo);
  convo.ask({
    text: "What are you looking for?",
    quickReplies: ["Burgers", "Beer", "Both"]
  }, sendVenues);
};

const saveLocation = (pld, convo) => {
  const attch = pld.message.attachments[0];
  const coords = attch.payload.coordinates;
  if (coords) {
    convo.set(COORDS_KEY, {
      lat: coords.lat,
      lng: coords.long
    })
  }
}

const sendVenues = (payload, convo) => {
  const type = saveType(payload, convo);
  findVenues(type, convo.get(COORDS_KEY)).then(venues => {
    handleVenues(venues, convo);
  });
};

const handleVenues = (venues, convo) => {
  convo.set(VENUES_KEY, venues);
  convo.set(PAGE_KEY, 0);
  sendNextPageOfVenues(convo);
};

const sendNextPageOfVenues = (convo) => {
  let page = convo.get(PAGE_KEY);
  page++;
  convo.set(PAGE_KEY, page);
  const offset = (page - 1) * pageSize;
  const venues = convo.get(VENUES_KEY);
  const pageOfVenues = venues.slice(offset, offset + pageSize);
  // We're out
  if (pageOfVenues.length == 0) {
    convo.set(PAGE_KEY, 0);
    askForOtherType(convo);
    return;
  }
  const venueObjects = pageOfVenues.map(mapVenueToTemplate);
  convo.sendGenericTemplate(venueObjects).then(() => askForMore(convo));
};

const askForOtherType = (convo) => {
  convo.ask({
    text: "We're out of locations.\nDo you want to look for something else?",
    quickReplies: ["Burgers", "Beer", "Both", "No, later"]
  }, filteredSendVenues);
};

const filteredSendVenues = (payload, convo) => {
  if ((/later/i).test(payload.message.text)) {
    convo.say("Ok, cool. Just say \"Hi\" later and I'll help you out").then(() => {
      convo.end();
    })
    return;
  }
  sendVenues(payload, convo);
};

const mapVenueToTemplate = (venue) => {
  const {lat, lng, address} = venue.location;
  return {
    title: venue.name,
    image_url: staticMapsURL({lat, lng}),
    subtitle: address,
    default_action: {
      type: "web_url",
      url: `https://foursquare.com/v/${venue.id}`,
      fallback_url: venue.url,
      messenger_extensions: true,
      webview_height_ratio: "tall",
    }
  }
}

const askForMore = convo => {
  convo.ask(
    {
      text: "Do you want to see more?",
      quickReplies: ["Yes", "No"]
    },
    (payload, convo) => {
      const answer = payload.message.text.toLowerCase();
      switch(answer) {
        case "yes":
          sendNextPageOfVenues(convo);
          break;
        case "no":
          convo.say("Thanks, see you later.").then(() => {
            convo.end();
          })
          break;
        default:
          convo.say("I don't understand").then(() => {
            askForMore(convo);
          });
          break;
      }
    }
  );
}

const saveType = (payload, convo) => {
  const answer = payload.message.text.toLowerCase(); 
  convo.set(TYPE_KEY, answer);
  return answer;
}

bot.on('message', (payload, chat, {captured}) => {
  if (captured) { return }
  const text = payload.message.text;
  chat.say(`Echo: ${text}`);
});

bot.start(config.get('PORT'));
