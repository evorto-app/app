/** Original attendee copy shared by the deterministic template fixtures. */
export function seedTemplateCopy(
  title: string,
  categoryTitle: string,
  originalDescription: string,
) {
  const introduction = originalDescription.match(/<p>.*?<\/p>/u)?.[0];
  if (!introduction) {
    throw new Error(`Missing introduction for seed template "${title}"`);
  }

  switch (categoryTitle) {
    case 'Hikes': {
      const challenging = ['Zugspitze hike', 'Kramer hike'].includes(title);
      const gentle = ['Eibsee hike', 'Partnach Gorge hike'].includes(title);
      const routeNote = challenging
        ? '<p><strong>A demanding mountain outing:</strong> this route is for people who already feel comfortable on long, steep mountain walks. Come prepared for uneven ground and sustained climbing; a good level of fitness matters more than speed.</p>'
        : gentle
          ? '<p>Take a break from the city and discover the landscape on foot. We will make room for conversation, photographs and a snack stop along the way. Even on a gentler route, paths can be wet or uneven, so come ready for an outdoor walk.</p>'
          : '<p>Expect an active outing with uphill sections, uneven paths and time to enjoy the view together. You do not need to race anyone: the best part is getting outside, meeting fellow students and sharing the trail.</p>';
      return {
        description: `${introduction}${routeNote}<h3>Pack for the trail</h3><ul><li>Walking shoes with a good grip and clothing for changing weather.</li><li>Enough drinking water, a packed lunch and a few snacks.</li><li>Sun protection and a waterproof layer, even if the forecast looks friendly.</li></ul><p>The route may change with weather and trail conditions. Choose this outing only if you are comfortable with the activity described.</p>`,
        registeredDescription:
          '<h3>Before we set off</h3><p>Have your registration ready for check-in and tell the organizers before departure if you have a concern about the route. Stay with the group and let an organizer know before leaving early.</p>',
      };
    }
    case 'City tours':
      return {
        description: `${introduction}<p>New to the area, or simply curious about the streets you pass every day? Come along for a relaxed walk with other students. There will be stories to share, details to spot and plenty of opportunities to chat between stops. You are welcome to join on your own.</p><h3>Along the way</h3><ol><li>Get to know the group and settle into the walk.</li><li>Explore local streets, squares and landmarks together.</li><li>Leave with ideas for places you might like to revisit.</li></ol><p><strong>Bring comfortable shoes</strong>, drinking water and a layer for the weather. The tour takes place on foot, with standing stops as well as walking.</p>`,
        registeredDescription:
          '<h3>Joining the group</h3><p>Keep your registration available for check-in. If you get separated during the walk, contact the organizers before trying to catch up; the group may already have moved to the next stop.</p>',
      };
    case 'City Trips':
      return {
        description: `${introduction}<p>Swap your usual surroundings for a new city and a group of people to explore it with. We will discover some of its character together, then leave space to follow your own curiosity, take photographs or find somewhere for a break.</p><h3>The plan</h3><p>Start with a group introduction to the city, enjoy time to explore and regroup before the outing ends. Expect walking on city streets and stretches spent outdoors.</p><h3>Plan your own extras</h3><ul><li>Bring comfortable shoes, water and weather-appropriate clothing.</li><li>Allow for your own food, drinks and any optional visits you choose.</li><li>Check your registration choice for what it covers before booking anything separately.</li></ul>`,
        registeredDescription:
          '<h3>Travel together</h3><p>Check the departure and regrouping instructions with the organizers before setting off. Keep your phone charged and tell an organizer if you leave the group during free time or make your own return arrangements.</p>',
      };
    case 'Sports': {
      const opening =
        title === 'Soccer Match'
          ? '<p>Fancy a kickabout and a chance to meet new people? Join us on the pitch for a friendly soccer session. Come ready to play, share the ball and enjoy a little friendly competition.</p>'
          : title === 'Basketball Game'
            ? '<p>Bring your energy to the court for a friendly basketball session. Whether you love a quick pass, a good rebound or simply trying something active with new people, there is room to get involved.</p>'
            : '<p>Gather around the net for a friendly volleyball tournament. Expect team spirit, plenty of rallies and a chance to play alongside people you have just met. Come for the game and stay for the conversations between rounds.</p>';
      return {
        description: `${opening}<h3>How we play</h3><p>We will warm up, form teams and explain the format before the games begin. Mixed experience levels are welcome; fair play and looking out for each other come first.</p><ul><li>Wear sports clothing and suitable shoes.</li><li>Bring drinking water and anything you personally need to play comfortably.</li><li>Check the available add-ons if you need equipment; rental is a separate choice where offered.</li></ul><p><strong>Tell the organizers about any limits before joining a game.</strong> Take breaks when you need them and help keep the session enjoyable for everyone.</p>`,
        registeredDescription:
          '<h3>Ready to play</h3><p>Show your registration at check-in and let the organizers know if you selected equipment rental. Wait for the warm-up and team briefing before starting, and return any borrowed equipment before leaving.</p>',
      };
    }
    case 'Weekend Trips': {
      const opening =
        title === 'Bavarian Forest Trip'
          ? '<p>Trade busy streets for forest paths and fresh air in the Bavarian Forest. Join a group of fellow students to explore green surroundings, share a walk and enjoy a change of scene together.</p>'
          : title === 'Black Forest Trip'
            ? '<p>Discover a different side of Germany with an outing to the Black Forest. Wooded landscapes and time outdoors make a welcoming backdrop for getting to know people beyond the usual campus routine.</p>'
            : '<p>Come and explore the Harz Mountains with other students. Enjoy the wooded landscape, discover a new region and share the small moments that make a group outing memorable, from a scenic stop to a conversation along the path.</p>';
      return {
        description: `${opening}<p>Expect a mix of group exploration and pauses to enjoy the surroundings. Bring a curious spirit and be comfortable walking outdoors; the programme can adapt to weather and local conditions.</p><h3>Before you join</h3><ul><li>Check the event schedule and your registration choice for the arrangements offered.</li><li>Pack practical shoes, layers, rain protection and a refillable water bottle.</li><li>Plan for your own meals and personal purchases unless your chosen option explicitly includes them.</li></ul><p>Any optional activities are your choice. Make sure their timing fits the shared programme before arranging them.</p>`,
        registeredDescription:
          '<h3>Keep the group together</h3><p>Confirm the travel and regrouping arrangements with the organizers before departure. Keep your phone charged, share any relevant travel concerns and let an organizer know before leaving the planned group activity.</p>',
      };
    }
    case 'Example setups': {
      const opening =
        title === 'Small Event Example'
          ? '<p>Meet a few new faces in a small, relaxed group. This gathering leaves space for proper introductions, easy conversation and the chance to get to know people beyond a quick hello.</p>'
          : title === 'Medium Event Example'
            ? '<p>Join a sociable gathering with enough people to discover different interests and enough space to get involved. Come on your own or with a friend; there will be opportunities to meet people outside your usual circle.</p>'
            : '<p>Be part of a lively community gathering and meet students from across the organization. Explore the programme at your own pace, make new connections and enjoy being part of a bigger group.</p>';
      return {
        description: `${opening}<h3>What to expect</h3><p>We will begin with a welcome and an introduction to the activities. You can join the conversation, take part in the shared programme and find your own rhythm as the group gets to know each other.</p><p><strong>Everyone helps make the atmosphere welcoming.</strong> Include newcomers, respect other people's boundaries and ask an organizer if you need help finding your way.</p><p>Check the event details and available registration choices before joining. Bring your curiosity and anything you personally need to feel comfortable during the gathering.</p>`,
        registeredDescription:
          '<h3>On arrival</h3><p>Have your registration ready for check-in, then join the welcome briefing. The organizers can help with questions about the programme or finding the right activity for you.</p>',
      };
    }
    default:
      throw new Error(`Unsupported seed template category "${categoryTitle}"`);
  }
}
