/* eslint-disable no-undef */
'use strict'

const puppeteer = require('puppeteer')

/**
 *
 * @param {options.username} string username
 * @param {options.password} string password
 * @param {options.loginUrl} string password
 * @param {options.args} array[string] string array which allows providing further arguments to puppeteer
 * @param {options.loginSelector} string a selector on the loginUrl page for the social provider button
 * @param {options.loginSelectorDelay} number delay a specific amount of time before clicking on the login button, defaults to 250ms. Pass a boolean false to avoid completely.
 * @param {options.postLoginSelector} string a selector on the app's post-login return page to assert that login is successful
 * @param {options.preLoginSelector} string a selector to find and click on before clicking on the login button (useful for accepting cookies)
 * @param {options.headless} boolean launch puppeteer in headless more or not
 * @param {options.logs} boolean whether to log cookies and other metadata to console
 * @param {options.getAllBrowserCookies} boolean whether to get all browser cookies instead of just for the loginUrl
 * @param {options.isPopup} boolean is your google auth displayed like a popup
 * @param {options.popupDelay} number delay a specific milliseconds before popup is shown. Pass a falsy (false, 0, null, undefined, '') to avoid completely
 * @param {options.cookieDelay} number delay a specific milliseconds before get a cookies. Pass a falsy (false, 0, null, undefined, '') to avoid completely.
 *
 */
module.exports.GoogleSocialLogin = async function GoogleSocialLogin(options = {}) {
  validateOptions(options)

  const launchOptions = {headless: !!options.headless}

  if (options.args && options.args.length) {
    launchOptions.args = options.args
  }

  const browser = await puppeteer.launch(launchOptions)
  let page = await browser.newPage()
  let originalPageIndex = 1
  await page.setViewport({width: 1280, height: 800})

  await page.goto(options.loginUrl)
  await login({page, options})

  // Switch to Popup Window
  if (options.isPopup) {
    if (options.popupDelay) {
      await delay(options.popupDelay)
    }
    const pages = await browser.pages()
    // remember original window index
    originalPageIndex = pages.indexOf(
      pages.find(p => page._target._targetId === p._target._targetId)
    )
    page = pages[pages.length - 1]
  }

  await page.screenshot({path: 'screenshot.png'})
  console.log('before typeUsername')
  await typeUsername({page, options})
  console.log('after typeUsername')

  console.log('before typePassword')
  await typePassword({page, options})
  console.log('after typePassword')

  console.log('before checkUserConsentIfNeeded')
  await checkUserConsentIfNeeded({page, options})
  console.log('after checkUserConsentIfNeeded')

  // Switch back to Original Window
  if (options.isPopup) {
    if (options.popupDelay) {
      await delay(options.popupDelay)
    }
    const pages = await browser.pages()
    page = pages[originalPageIndex]
  }

  if (options.cookieDelay) {
    await delay(options.cookieDelay)
  }

  console.log('before getCookies')
  const cookies = await getCookies({page, options})
  console.log('after getCookies')

  const lsd = await getLocalStorageData({page, options})
  const ssd = await getSessionStorageData({page, options})
  await finalizeSession({page, browser, options})

  return {
    cookies,
    lsd,
    ssd
  }
}

function delay(time) {
  return new Promise(function(resolve) {
    setTimeout(resolve, time)
  })
}

function validateOptions(options) {
  if (!options.username || !options.password) {
    throw new Error('Username or Password missing for social login')
  }
}

async function login({page, options} = {}) {
  if (options.preLoginSelector) {
    await page.waitForSelector(options.preLoginSelector)
    await page.click(options.preLoginSelector)
  }

  await page.waitForSelector(options.loginSelector)

  if (options.loginSelectorDelay !== false) {
    await delay(options.loginSelectorDelay)
  }

  await page.click(options.loginSelector)
}

async function typeUsername({page, options} = {}) {
  let buttonSelector = options.headless ? '#next' : '#identifierNext'

  await page.waitForSelector('input[type="email"]')
  await page.type('input[type="email"]', options.username)
  await page.click(buttonSelector)
}

async function typePassword({page, options} = {}) {
  let buttonSelectors = ['#signIn', '#passwordNext', '#submit']

  await page.waitForSelector('input[type="password"]', {visible: true})
  await page.type('input[type="password"]', options.password)

  const buttonSelector = await waitForMultipleSelectors(buttonSelectors, {visible: true}, page)
  await page.click(buttonSelector)
}

async function checkUserConsentIfNeeded({page, options}) {
  // don't throw if element not found - it's an OK state
  // if the user already has an account or the apps does not run
  // on localhost
  try {
    await page.waitForSelector(options.userConsentSelector)

    await page.click(options.userConsentSelector)
  } catch (err) {}
}

async function getCookies({page, options} = {}) {
  await page.waitForSelector(options.postLoginSelector)

  const cookies = options.getAllBrowserCookies
    ? await getCookiesForAllDomains(page)
    : await page.cookies(options.loginUrl)

  if (options.logs) {
    console.log(cookies)
  }

  return cookies
}

async function getLocalStorageData({page, options} = {}) {
  await page.waitForSelector(options.postLoginSelector)

  const localStorageData = await page.evaluate(() => {
    let json = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      json[key] = localStorage.getItem(key)
    }
    return json
  })
  if (options.logs) {
    console.log(localStorageData)
  }

  return localStorageData
}

async function getSessionStorageData({page, options} = {}) {
  await page.waitForSelector(options.postLoginSelector)

  const sessionStorageData = await page.evaluate(() => {
    let json = {}
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)
      json[key] = sessionStorage.getItem(key)
    }
    return json
  })
  if (options.logs) {
    console.log(sessionStorageData)
  }

  return sessionStorageData
}

async function getCookiesForAllDomains(page) {
  const cookies = await page._client.send('Network.getAllCookies', {})
  return cookies.cookies
}

async function finalizeSession({page, browser, options} = {}) {
  await browser.close()
}

async function waitForMultipleSelectors(selectors, options, page) {
  const navigationOutcome = await racePromises(
    selectors.map(selector => page.waitForSelector(selector, options))
  )
  return selectors[parseInt(navigationOutcome)]
}

async function racePromises(promises) {
  const wrappedPromises = []
  let resolved = false
  promises.map((promise, index) => {
    wrappedPromises.push(
      new Promise(resolve => {
        promise.then(
          () => {
            resolve(index)
          },
          error => {
            if (!resolved) {
              throw error
            }
          }
        )
      })
    )
  })
  return Promise.race(wrappedPromises).then(index => {
    resolved = true
    return index
  })
}
