#!/usr/bin/env node
'use strict'

const emailRegex = require('email-regex')
const jsonFuture = require('json-future')
const colors = require('picocolors')
const $ = require('tinyspawn')
const path = require('path')
const mri = require('mri')
const fs = require('fs')

const BOT_NAMES = ['ImgBotApp', 'greenkeeper', 'noreply', '\\bbot\\b', 'Travis CI']

const REGEX_BOT_NAMES = new RegExp(BOT_NAMES.join('|'), 'i')

const isString = value => typeof value === 'string'

const REGEX_EMAIL_VARIATIONS = /[.+]/g

const normalizeEmail = email => email.toLowerCase().replace(REGEX_EMAIL_VARIATIONS, '')

const isSameEmail = (email1 = '', email2 = '') => normalizeEmail(email1) === normalizeEmail(email2)

const flags = mri(process.argv.slice(2), {
  default: {
    cwd: process.cwd(),
    print: '',
    save: true,
    ignorePattern: []
  }
})

if (flags.print === '') flags.print = true

const loadPkg = path => {
  try {
    return jsonFuture.loadAsync(path)
  } catch (err) {
    return null
  }
}

const getMaxIndent = (contributors, propName) => {
  const sorted = contributors.sort((c1, c2) => c2[propName] - c1[propName])
  const first = sorted[0][propName]
  return String(first).length
}

const indent = (maxIndentation, prop = '') => {
  const indentSize = maxIndentation - String(prop).length
  return Array.from({ length: indentSize }, () => ' ').join('')
}

const renderContributorsVerbose = (contributors, maxIndent) => {
  const maxIndexIndent = String(contributors.length).length

  console.log()
  contributors.forEach(({ author, commits, name }, index) => {
    const prettyAuthor = colors.gray(author.replace(name, colors.white(name)))
    const prettyCommits = colors.white(`${indent(maxIndent, commits)}${commits}`)
    const humanIndex = index + 1
    const prettyIndex = colors.gray(`${indent(maxIndexIndent, humanIndex)}${humanIndex}`)
    console.log(`  ${prettyIndex} ${prettyCommits} ${prettyAuthor}`)
  })
}

const renderContributors = (contributors, maxIndent) => {
  console.log()
  contributors.forEach(({ author, commits, name }) => {
    const prettyAuthor = colors.gray(author.replace(name, colors.white(name)))
    const prettyCommits = colors.white(`${indent(maxIndent, commits)}${commits}`)
    console.log(`  ${prettyCommits}  ${prettyAuthor}`)
  })
}

const processError = error => {
  console.log(colors.red(error.message || error))
  process.exit(1)
}

const gitLogExtractor = /^\s*(\d*)\s*((.*)<(.*)>)$/gim
const extractContributors = stdout => {
  const result = []
  let item
  while ((item = gitLogExtractor.exec(stdout))) {
    if (item[1] && item[2] && item[3] && item[4]) {
      result.push({
        author: item[2].trim(),
        commits: Number(item[1].trim()),
        email: item[4].trim(),
        name: item[3].trim()
      })
    }
  }
  return result
}

const getContributors = async () => {
  if (!fs.existsSync('.git')) {
    return processError({
      message: 'Ops, not git directory detected!'
    })
  }

  const { print, cwd, save, ignorePattern } = flags
  const pkgPath = path.join(cwd, 'package.json')
  const { stdout, stderr } = await $('git shortlog -sne HEAD', {
    cwd,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe']
  })

  if (stderr) return processError(stderr)

  const { author: pkgAuthor = {} } = require(pkgPath)
  const ignorePatternReg =
    ignorePattern.length === 0 ? undefined : new RegExp(`(${ignorePattern.join('|')})`, 'i')

  const contributors = extractContributors(stdout)
    .reduce((acc, contributor) => {
      const index = acc.findIndex(({ email }) => isSameEmail(email, contributor.email))
      const isPresent = index !== -1
      if (!isPresent) return acc.concat(contributor)
      acc[index].commits += contributor.commits
      return acc
    }, [])
    .reduce((acc, contributor) => {
      const index = acc.findIndex(({ name }) => name === contributor.name)
      const isPresent = index !== -1
      if (!isPresent) return acc.concat(contributor)
      acc[index].commits += contributor.commits
      return acc
    }, [])
    .filter(({ name }) => !REGEX_BOT_NAMES.test(name))
    .filter(({ email }) =>
      isString(pkgAuthor)
        ? !new RegExp(pkgAuthor, 'i').test(email)
        : !isSameEmail(pkgAuthor.email, email)
    )
    .filter(({ email }) => emailRegex().test(email))
    .filter(({ author }) => !(ignorePatternReg && ignorePatternReg.test(author)))
    .sort(
      (c1, c2) =>
        c1.commits - c2.commits || // sort by commit count
        c1.email.localeCompare(c2.email) || // if equal, sort by email
        c1.name.toLowerCase().localeCompare(c2.name.toLowerCase()) // if equal, sort by name
    )

  const maxIndent = contributors.length ? getMaxIndent(contributors, 'commits') : ''

  if (contributors.length) {
    if (print) {
      (print === 'verbose' ? renderContributorsVerbose : renderContributors)(
        contributors,
        maxIndent
      )
    }
    const pkg = await loadPkg(pkgPath)

    if (pkg && save) {
      const newContributors = contributors.map(({ author }) => author)
      const newPkg = { ...pkg, contributors: newContributors }
      await jsonFuture.saveAsync(pkgPath, newPkg)
      if (print) {
        console.log(
          `\n${indent(maxIndent)} ${colors.gray(`Added into ${colors.white('package.json')} ✨`)}`
        )
      }
    }
  }
}

Promise.resolve(flags.help ? console.log(require('./help')) : getContributors()).catch(error => {
  console.log(colors.red(error.message || error))
  process.exit(1)
})
