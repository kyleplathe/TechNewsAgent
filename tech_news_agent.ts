import { chromium } from 'playwright';

async function generateDailyScript() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log("Scraping tech news...");
  
  // 1. Scrape Hacker News (or any tech site you prefer)
  await page.goto('https://news.ycombinator.com/');
  const headlines = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.titleline > a'))
      .slice(0, 10)
      .map(el => el.textContent);
  });

  await browser.close();

  // 2. Format the payload for the AI (using your API key)
  const prompt = `
    You are a professional tech news anchor. 
    Write a 60-second, high-energy TV script based on these headlines:
    ${headlines.join('\n')}
    
    Requirements:
    - Focus on hardware, electronics repair, and Bitcoin.
    - Start with: "Good morning! I'm Kyle, and here's what's hitting the bench today."
    - Use short, punchy sentences for a teleprompter.
    - End with: "Back to the soldering iron. Catch you tomorrow."
  `;

  console.log("Generating script...");
  
  // This calls the AI to process the news into your script
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: "claude-3-5-sonnet-latest",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }]
    })
  });

  const data = await response.json();
  const script = data.content[0].text;

  // 3. Output the script
  console.log("\n--- YOUR DAILY SCRIPT ---\n");
  console.log(script);
  
  // Optional: Save it to a file
  // fs.writeFileSync(`scripts/script_${new Date().toISOString().split('T')[0]}.txt`, script);
}

generateDailyScript();
