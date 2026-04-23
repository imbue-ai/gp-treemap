/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "MultiMatchStringTest.h"

#import "TestDescriptions.h"


@interface MultiMatchStringTest (PrivateMethods) 

/* Not implemented. Needs to be provided by subclass.
 */
- (BOOL) testString:(NSString *)string matches:(NSString *)matchTarget;

/* Not implemented. Needs to be provided by subclass.
 *
 * It should return a string with two "%@" arguments. The first for the subject of the test and the
 * second for the description of the match targets.
 *
 * Furthermore, the descriptionFormat should somehow indicate whether or not the matching is
 * case-sensitive.
 */
@property (nonatomic, readonly, copy) NSString *descriptionFormat;

@end


@implementation MultiMatchStringTest

- (instancetype) initWithMatchTargets:(NSArray *)matchTargets {
  return [self initWithMatchTargets: matchTargets caseSensitive: YES];
}
  
- (instancetype) initWithMatchTargets:(NSArray *)matchTargets caseSensitive:(BOOL)caseSensitive {
  if (self = [super init]) {
    NSAssert([matchTargets count] >= 1, @"There must at least be one possible match.");

    // Make the array immutable
    _matchTargets = [[NSArray alloc] initWithArray: matchTargets];
    _caseSensitive = caseSensitive;
  }
  
  return self;
}

- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  if (self = [super initWithPropertiesFromDictionary: dict]) {
    NSArray  *tmpMatches = dict[@"matches"];

    // Make the array immutable
    _matchTargets = [[NSArray alloc] initWithArray: tmpMatches];

    _caseSensitive = [dict[@"caseSensitive"] boolValue];
  }

  return self;
}

- (void) dealloc {
  [_matchTargets release];

  [super dealloc];
}


- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"matches"] = self.matchTargets;
  
  dict[@"caseSensitive"] = @(self.isCaseSensitive);
}


- (NSDictionary *)dictionaryForObject {
  NSMutableDictionary  *dict = [NSMutableDictionary dictionaryWithCapacity: 8];
  
  [self addPropertiesToDictionary: dict];
  
  return dict;
}


- (BOOL) testString:(NSString *)string {
  NSUInteger  i = self.matchTargets.count;
  while (i-- > 0) {
    if ([self testString: string matches: self.matchTargets[i]]) {
      return YES;
    }
  }
  
  return NO;
}


- (NSString *)descriptionWithSubject:(NSString *)subject {
  // Note: Whether or not the matching is case-sensitive is not indicated here.
  // This is the responsibility of the descriptionFormat method. 

  NSString  *matchTargetsDescr = descriptionForMatchTargets(self.matchTargets);

  return [NSString stringWithFormat: self.descriptionFormat, subject, matchTargetsDescr];
}

@end // @implementation MultiMatchStringTest

